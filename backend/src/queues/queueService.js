import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import {
  createProducerConnection,
  createWorkerConnection,
  getRedisConfig,
} from "../config/redis.js";
import { logger } from "../services/logger.js";
import { processNotificationJob, runReminderSweep } from "./processors.js";

export const QUEUE_NAMES = Object.freeze({
  NOTIFICATIONS: "notifications",
  REMINDERS: "reminders",
});

export const REMINDER_SCHEDULER_ID = "reminder-sweep";

const NOTIFICATION_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
});

const READY_TIMEOUT_MS = 5_000;
const ENQUEUE_TIMEOUT_MS = 3_000;
const CLOSE_TIMEOUT_MS = 5_000;

let state = createEmptyState();

function withTimeout(promise, timeoutMs, label) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createEmptyState() {
  return {
    status: "disabled",
    config: null,
    producerConnection: null,
    workerConnections: [],
    queues: {},
    workers: [],
    watchdog: null,
  };
}

function waitUntilReady(connection, timeoutMs = READY_TIMEOUT_MS) {
  if (connection.status === "ready") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    function onReady() {
      cleanup();
      resolve();
    }

    function cleanup() {
      clearTimeout(timer);
      connection.off("ready", onReady);
    }

    connection.on("ready", onReady);
  });
}

// ioredis emits an `error` event on every failed reconnect attempt. Log the
// first one of each outage instead of flooding the log.
function attachConnectionLogging(connection, role) {
  let reportedOutage = false;

  connection.on("error", (error) => {
    if (!reportedOutage) {
      reportedOutage = true;
      logger.warn("redis_connection_error", { role, errorMessage: error.message });
    }
  });

  connection.on("ready", () => {
    if (reportedOutage) {
      logger.info("redis_connection_restored", { role });
    }
    reportedOutage = false;
  });
}

function createWorker(name, processor, { prefix, url, concurrency }) {
  const connection = createWorkerConnection(url);
  attachConnectionLogging(connection, `worker:${name}`);
  state.workerConnections.push(connection);

  const worker = new Worker(name, processor, { connection, prefix, concurrency });

  worker.on("failed", (job, error) => {
    logger.warn("queue_job_failed", {
      queue: name,
      jobName: job?.name,
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      errorMessage: error?.message,
    });
  });

  worker.on("error", (error) => {
    logger.warn("queue_worker_error", { queue: name, errorMessage: error?.message });
  });

  return worker;
}

/**
 * Starts the BullMQ queues, the workers and the reminder job scheduler.
 *
 * Without REDIS_URL this does nothing and notifications stay disabled. If
 * Redis is configured but unreachable, startup still succeeds in a
 * "degraded" state: ioredis keeps reconnecting and the workers resume on
 * their own once Redis is back.
 */
export async function startQueues({ config = getRedisConfig(), runWorkers = true } = {}) {
  if (state.status !== "disabled") {
    return getQueueStatus();
  }

  if (!config.enabled) {
    logger.warn("queues_disabled", {
      reason: "REDIS_URL is not set; in-app notifications and reminders are off",
    });
    return getQueueStatus();
  }

  state.status = "starting";
  state.config = config;

  const { url, prefix, reminderSweepIntervalMs } = config;
  const producerConnection = createProducerConnection(url);
  attachConnectionLogging(producerConnection, "producer");
  state.producerConnection = producerConnection;

  const queueOptions = { connection: producerConnection, prefix };
  state.queues.notifications = new Queue(QUEUE_NAMES.NOTIFICATIONS, queueOptions);
  state.queues.reminders = new Queue(QUEUE_NAMES.REMINDERS, queueOptions);

  for (const [name, queue] of Object.entries(state.queues)) {
    queue.on("error", (error) => {
      logger.warn("queue_error", { queue: name, errorMessage: error?.message });
    });
  }

  if (runWorkers) {
    state.workers.push(
      createWorker(QUEUE_NAMES.NOTIFICATIONS, (job) => processNotificationJob(job), {
        prefix,
        url,
        concurrency: 5,
      }),
      createWorker(QUEUE_NAMES.REMINDERS, () => runReminderSweep(), {
        prefix,
        url,
        concurrency: 1,
      }),
    );
  }

  const startedState = state;

  async function registerReminderScheduler() {
    // Idempotent: every API instance upserts the same scheduler, and BullMQ
    // makes sure only one sweep job exists per interval.
    await startedState.queues.reminders.upsertJobScheduler(
      REMINDER_SCHEDULER_ID,
      { every: reminderSweepIntervalMs },
      {
        name: "sweep",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
      },
    );

    startedState.status = "ready";
    logger.info("queues_started", {
      prefix,
      tls: config.tls,
      reminderSweepIntervalMs,
      workers: startedState.workers.length,
    });
  }

  try {
    await waitUntilReady(producerConnection);
    await registerReminderScheduler();
  } catch (error) {
    state.status = "degraded";
    logger.error("queues_start_degraded", { errorMessage: error.message });
  }

  // Watchdog: the reminder scheduler lives in Redis. If Redis was down at
  // startup, or later lost its data (FLUSHALL, a provider reset, a failover
  // to a replica without persistence), reminders would silently stop until
  // a restart. Re-register it whenever it is missing.
  let checking = false;
  startedState.watchdog = setInterval(async () => {
    if (checking || state !== startedState || producerConnection.status !== "ready") {
      return;
    }

    checking = true;

    try {
      const existing = await startedState.queues.reminders.getJobScheduler(REMINDER_SCHEDULER_ID);

      if (!existing) {
        const wasReady = startedState.status === "ready";
        await registerReminderScheduler();

        if (wasReady) {
          logger.warn("reminder_scheduler_restored", { reason: "scheduler missing from Redis" });
        }
      }
    } catch (watchdogError) {
      logger.warn("reminder_scheduler_check_failed", { errorMessage: watchdogError.message });
    } finally {
      checking = false;
    }
  }, getWatchdogIntervalMs(reminderSweepIntervalMs));
  startedState.watchdog.unref?.();

  return getQueueStatus();
}

/** Between 5s and 60s: three sweep intervals, so tests and E2E heal quickly. */
export function getWatchdogIntervalMs(reminderSweepIntervalMs) {
  return Math.min(60_000, Math.max(5_000, reminderSweepIntervalMs * 3));
}

/**
 * Closes workers (letting a running job finish), queues and connections.
 * Never blocks shutdown for long: a connection that is down is dropped
 * instead of waiting for it to come back.
 */
export async function stopQueues() {
  const current = state;
  state = createEmptyState();

  clearInterval(current.watchdog);

  const redisUp = current.producerConnection?.status === "ready";

  for (const worker of current.workers) {
    await withTimeout(worker.close(!redisUp), CLOSE_TIMEOUT_MS, "worker close").catch(() => {});
  }

  for (const queue of Object.values(current.queues)) {
    await withTimeout(queue.close(), CLOSE_TIMEOUT_MS, "queue close").catch(() => {});
  }

  for (const connection of [current.producerConnection, ...current.workerConnections]) {
    if (!connection) continue;

    if (connection.status === "ready") {
      await withTimeout(connection.quit(), CLOSE_TIMEOUT_MS, "redis quit").catch(() =>
        connection.disconnect(),
      );
    } else {
      connection.disconnect();
    }
  }
}

/**
 * "disabled" | "starting" | "ready" | "degraded". "ready" also requires the
 * producer connection to be up right now.
 */
export function getQueueStatus() {
  if (state.status === "ready" && state.producerConnection?.status !== "ready") {
    return "degraded";
  }

  return state.status;
}

/** Exposed for tests and the E2E reset script. */
export function getQueues() {
  return state.queues;
}

/**
 * Adds a notification job. Never throws: a Redis outage must not fail the
 * HTTP request whose data was already committed. Returns the job, or null
 * when notifications are disabled or the add failed.
 */
export async function enqueueNotification(type, data) {
  const queue = state.queues.notifications;

  if (!queue) {
    return null;
  }

  // BullMQ waits for the connection to be ready before sending a command, so
  // during an outage an add would stay pending until Redis returns. Skip it
  // instead of letting pending adds pile up in memory.
  if (state.producerConnection?.status !== "ready") {
    logger.warn("notification_enqueue_skipped", { type, reason: "redis_not_ready" });
    return null;
  }

  try {
    return await withTimeout(
      queue.add(type, data, { ...NOTIFICATION_JOB_OPTIONS, jobId: randomUUID() }),
      ENQUEUE_TIMEOUT_MS,
      "enqueue",
    );
  } catch (error) {
    logger.warn("notification_enqueue_failed", { type, errorMessage: error.message });
    return null;
  }
}
