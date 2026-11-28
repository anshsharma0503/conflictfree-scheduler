import IORedis from "ioredis";

const DEFAULT_PREFIX = "conflictfree";
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1_000;

/**
 * Reads the Redis/BullMQ settings from the environment.
 *
 * - REDIS_URL: `redis://host:port` locally (Docker), `rediss://…` for TLS
 *   providers such as Upstash or Redis Cloud. When it is missing, background
 *   jobs are disabled and the API still runs (Decision 44).
 * - BULLMQ_PREFIX: namespaces every BullMQ key, so dev, test and E2E can
 *   share one Redis without touching each other's jobs.
 * - REMINDER_SWEEP_INTERVAL_MS: how often the reminder sweep runs.
 */
export function getRedisConfig(env = process.env) {
  const url = typeof env.REDIS_URL === "string" ? env.REDIS_URL.trim() : "";
  const prefix = (env.BULLMQ_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;

  if (url) {
    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
    }

    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error("REDIS_URL must start with redis:// or rediss://");
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
    throw new Error("BULLMQ_PREFIX may only contain letters, digits, '_' and '-'");
  }

  const rawInterval = Number(env.REMINDER_SWEEP_INTERVAL_MS);
  const reminderSweepIntervalMs =
    Number.isFinite(rawInterval) && rawInterval >= MIN_SWEEP_INTERVAL_MS
      ? Math.floor(rawInterval)
      : DEFAULT_SWEEP_INTERVAL_MS;

  return {
    enabled: Boolean(url),
    url,
    tls: url.startsWith("rediss://"),
    prefix,
    reminderSweepIntervalMs,
  };
}

/**
 * Producer connection, used by the API when it adds jobs during an HTTP
 * request. It fails fast while Redis is down (no offline queue) so a request
 * never hangs waiting for Redis; the failure is logged and the request still
 * succeeds.
 */
export function createProducerConnection(url) {
  return new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    lazyConnect: false,
  });
}

/**
 * Worker connection. BullMQ workers use blocking commands and must retry
 * forever, which requires `maxRetriesPerRequest: null`.
 */
export function createWorkerConnection(url) {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
  });
}
