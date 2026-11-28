// Phase M end to end inside the backend: real Redis (Docker), real BullMQ
// workers, real MongoDB replica set, real HTTP server and real Socket.io.
//
// Requires Redis at REDIS_URL_TEST / REDIS_URL (default redis://127.0.0.1:6379).
// Every key lives under the "cftest" prefix (see tests/helpers/testEnv.js).
import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { getRedisConfig } from "../src/config/redis.js";
import Event from "../src/models/Event.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import {
  QUEUE_NAMES,
  REMINDER_SCHEDULER_ID,
  enqueueNotification,
  getQueueStatus,
  getQueues,
  startQueues,
  stopQueues,
} from "../src/queues/queueService.js";
import { closeSocketServer, createSocketServer } from "../src/realtime/socketServer.js";
import { AUTH_COOKIE_NAME } from "../src/services/authCookieService.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const ALLOWED_ORIGIN = "http://localhost:5173";
const emails = ["qi-org@example.com", "qi-alpha@example.com"];
const config = { ...getRedisConfig(), reminderSweepIntervalMs: 1000 };

let httpServer;
let ioServer;
let baseUrl;
let organizer;
let alpha;
const openSockets = new Set();

assert.equal(config.prefix, "cftest", "queue tests must run under the cftest prefix");

function tokenFor(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({ id: user._id.toString(), email: user.email, name: user.name });
}

function as(user) {
  const auth = `Bearer ${tokenFor(user)}`;
  return {
    get: (path) => request(app).get(path).set("Authorization", auth),
    post: (path, body) => request(app).post(path).set("Authorization", auth).send(body),
    patch: (path, body) => request(app).patch(path).set("Authorization", auth).send(body),
  };
}

function connectAs(user) {
  const socket = connectClient(baseUrl, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { Cookie: `${AUTH_COOKIE_NAME}=${tokenFor(user)}`, Origin: ALLOWED_ORIGIN },
    reconnection: false,
    forceNew: true,
  });
  openSockets.add(socket);

  return new Promise((resolve, reject) => {
    socket.once("session:ready", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function waitForNotification(socket, predicate = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("notification:created", listener);
      reject(new Error("timed out waiting for notification:created"));
    }, timeoutMs);

    function listener(payload) {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off("notification:created", listener);
        resolve(payload);
      }
    }

    socket.on("notification:created", listener);
  });
}

async function obliterateTestQueues() {
  const connection = new IORedis(config.url, { maxRetriesPerRequest: null });

  try {
    for (const name of Object.values(QUEUE_NAMES)) {
      const queue = new Queue(name, { connection, prefix: config.prefix });
      await queue.obliterate({ force: true });
      await queue.close();
    }
  } finally {
    await connection.quit();
  }
}

async function createUser(name, email) {
  return User.create({
    name,
    email,
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });
}

before(async () => {
  process.env.FRONTEND_URL = ALLOWED_ORIGIN;
  await connectDatabase();
  await Notification.init();

  try {
    await obliterateTestQueues();
  } catch (error) {
    throw new Error(
      `Redis is required for queue tests (${config.url}). Start it with ` +
        `"docker compose up -d redis". Cause: ${error.message}`,
    );
  }

  httpServer = http.createServer(app);
  ioServer = createSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const status = await startQueues({ config });
  assert.equal(status, "ready");
});

beforeEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.clear();

  await Event.deleteMany({});
  await Notification.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });

  organizer = await createUser("Queue Organizer", emails[0]);
  alpha = await createUser("Queue Alpha", emails[1]);
});

after(async () => {
  for (const socket of openSockets) socket.disconnect();
  await stopQueues();
  await obliterateTestQueues().catch(() => {});
  await closeSocketServer(ioServer);
  await new Promise((resolve) => httpServer.close(() => resolve()));
  await Event.deleteMany({});
  await Notification.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });
  await disconnectDatabase();
});

test("confirming a meeting queues a job whose worker notifies the invitee live", async () => {
  const alphaSocket = await connectAs(alpha);
  const pushed = waitForNotification(alphaSocket);

  const startAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  const confirm = await as(organizer).post("/api/meetings/confirm", {
    title: "Queue sync",
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
    participantEmails: [alpha.email],
  });
  assert.equal(confirm.status, 201);

  const { notification, unreadCount } = await pushed;
  assert.equal(notification.type, "invitation.created");
  assert.equal(notification.message, "Queue Organizer invited you to “Queue sync”");
  assert.equal(notification.eventId, confirm.body.meeting.id);
  assert.equal(unreadCount, 1);

  const list = await as(alpha).get("/api/notifications");
  assert.equal(list.body.notifications.length, 1);
  assert.equal((await as(organizer).get("/api/notifications")).body.notifications.length, 0);
});

test("accepting an invitation notifies the organizer through the queue", async () => {
  const startAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  const confirm = await as(organizer).post("/api/meetings/confirm", {
    title: "RSVP check",
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
    participantEmails: [alpha.email],
  });

  const organizerSocket = await connectAs(organizer);
  const pushed = waitForNotification(organizerSocket, (p) => p.notification.type === "invitation.responded");

  const response = await as(alpha).patch(
    `/api/meetings/${confirm.body.meeting.id}/invitation-response`,
    { status: "accepted" },
  );
  assert.equal(response.status, 200);

  const { notification } = await pushed;
  assert.equal(notification.message, "Queue Alpha accepted “RSVP check”");
});

test("rescheduling a shared meeting notifies attendees; a description edit does not", async () => {
  const startAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  const confirm = await as(organizer).post("/api/meetings/confirm", {
    title: "Planning",
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
    participantEmails: [alpha.email],
  });
  const meetingId = confirm.body.meeting.id;
  const alphaSocket = await connectAs(alpha);

  const descriptionOnly = await request(app)
    .patch(`/api/events/${meetingId}`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({ description: "Agenda attached" });
  assert.equal(descriptionOnly.status, 200);

  const rescheduled = waitForNotification(alphaSocket, (p) => p.notification.type === "meeting.updated");
  const newStart = new Date(startAt.getTime() + 2 * 3_600_000);
  const move = await request(app)
    .patch(`/api/events/${meetingId}`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({
      startAt: newStart.toISOString(),
      endAt: new Date(newStart.getTime() + 3_600_000).toISOString(),
    });
  assert.equal(move.status, 200);

  const { notification } = await rescheduled;
  assert.equal(notification.message, "Queue Organizer rescheduled “Planning”");
  assert.equal(notification.data.startAt, newStart.toISOString());
  assert.equal(
    await Notification.countDocuments({ user: alpha._id, type: "meeting.updated" }),
    1,
    "the description-only edit produced no notification",
  );
});

test("deleting a shared meeting tells its participants", async () => {
  const startAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  const confirm = await as(organizer).post("/api/meetings/confirm", {
    title: "Retro",
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
    participantEmails: [alpha.email],
  });
  const alphaSocket = await connectAs(alpha);
  const pushed = waitForNotification(alphaSocket, (p) => p.notification.type === "meeting.cancelled");

  const response = await request(app)
    .delete(`/api/events/${confirm.body.meeting.id}`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`);
  assert.equal(response.status, 200);

  const { notification } = await pushed;
  assert.equal(notification.message, "Queue Organizer removed “Retro”");
  assert.equal(notification.eventId, null);
});

test("notification jobs carry ids only, a unique job id and retry settings", async () => {
  const job = await enqueueNotification("invitation.created", { eventId: "64b7f0f0f0f0f0f0f0f0f0f0" });

  assert.ok(job, "job was queued");
  assert.match(job.id, /^[0-9a-f-]{36}$/);
  assert.equal(job.opts.attempts, 5);
  assert.deepEqual(job.opts.backoff, { type: "exponential", delay: 1000 });
  assert.deepEqual(Object.keys(job.data), ["eventId"]);
});

test("the reminder job scheduler delivers a due reminder without any request", async () => {
  const scheduler = await getQueues().reminders.getJobScheduler(REMINDER_SCHEDULER_ID);
  assert.ok(scheduler, "reminder sweep scheduler is registered");
  assert.equal(Number(scheduler.every), 1000);

  const socket = await connectAs(organizer);
  const pushed = waitForNotification(socket, (p) => p.notification.type === "event.reminder");

  // Starts in 5 minutes: inside the default 15-minute lead.
  const startAt = new Date(Date.now() + 5 * 60_000);
  await Event.create({
    owner: organizer._id,
    title: "Standup",
    startAt,
    endAt: new Date(startAt.getTime() + 15 * 60_000),
    timezone: "UTC",
  });

  const { notification } = await pushed;
  assert.equal(notification.message, "“Standup” starts in 5 minutes");

  // Further sweeps must not repeat it.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(await Notification.countDocuments({ user: organizer._id, type: "event.reminder" }), 1);
});

test("if Redis loses the reminder queue's data, the watchdog restores the scheduler", async () => {
  const reminders = getQueues().reminders;

  // Simulate data loss (FLUSHALL / provider reset) for this queue only.
  const raw = new IORedis(config.url, { maxRetriesPerRequest: 1 });
  try {
    const keys = await raw.keys(`${config.prefix}:${QUEUE_NAMES.REMINDERS}:*`);
    assert.ok(keys.length > 0);
    await raw.del(...keys);
  } finally {
    raw.disconnect();
  }
  assert.equal(await reminders.getJobScheduler(REMINDER_SCHEDULER_ID), undefined);
  const lostAt = Date.now();

  const socket = await connectAs(organizer);
  const pushed = waitForNotification(socket, (p) => p.notification.type === "event.reminder", 12000);

  const startAt = new Date(Date.now() + 5 * 60_000);
  await Event.create({
    owner: organizer._id,
    title: "After data loss",
    startAt,
    endAt: new Date(startAt.getTime() + 15 * 60_000),
    timezone: "UTC",
  });

  const { notification } = await pushed;
  assert.equal(notification.message, "“After data loss” starts in 5 minutes");
  assert.ok(await reminders.getJobScheduler(REMINDER_SCHEDULER_ID), "scheduler is back");
  // Recovered by the watchdog (5s here), not instantly by BullMQ itself.
  assert.ok(Date.now() - lostAt <= 10_000, "restored within the watchdog window");
});

test("with Redis unreachable the API still works and queueing fails softly", async () => {
  await stopQueues();
  assert.equal(getQueueStatus(), "disabled");
  assert.equal(await enqueueNotification("invitation.created", { eventId: "x" }), null);

  const status = await startQueues({
    config: { ...config, url: "redis://127.0.0.1:6399" },
  });
  assert.equal(status, "degraded");

  const startAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  const confirm = await as(organizer).post("/api/meetings/confirm", {
    title: "Works without Redis",
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
    participantEmails: [alpha.email],
  });
  assert.equal(confirm.status, 201, "the request is not failed by the queue");
  assert.equal(await enqueueNotification("invitation.created", { eventId: "x" }), null);

  const preferences = await as(organizer).get("/api/notifications/preferences");
  assert.equal(preferences.body.preferences.deliveryStatus, "degraded");

  await stopQueues();
});
