import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Notification, {
  NOTIFICATION_RETENTION_SECONDS,
  NOTIFICATION_TYPES,
} from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { createNotifications } from "../src/services/notifications/notificationService.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const emails = ["nr-owner@example.com", "nr-other@example.com"];

let owner;
let other;

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

function record(user, index, extra = {}) {
  return {
    user: user._id,
    type: NOTIFICATION_TYPES.INVITATION_CREATED,
    message: `Notification ${index}`,
    event: null,
    data: { eventTitle: `Meeting ${index}`, startAt: new Date("2026-12-01T10:00:00Z") },
    dedupeKey: `test:${user.id}:${index}`,
    ...extra,
  };
}

async function seed(user, count) {
  // One at a time so createdAt strictly increases.
  for (let index = 1; index <= count; index += 1) {
    await createNotifications([record(user, index)]);
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
}

before(async () => {
  await connectDatabase();
  await Notification.init();
});

beforeEach(async () => {
  await Notification.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });

  const base = { timezone: "UTC", authProvider: "local", passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456" };
  owner = await User.create({ name: "Owner", email: emails[0], ...base });
  other = await User.create({ name: "Other", email: emails[1], ...base });
});

after(async () => {
  await Notification.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });
  await disconnectDatabase();
});

test("every notification route requires authentication", async () => {
  for (const [method, path] of [
    ["get", "/api/notifications"],
    ["post", "/api/notifications/read-all"],
    ["patch", "/api/notifications/64b7f0f0f0f0f0f0f0f0f0f0/read"],
    ["get", "/api/notifications/preferences"],
    ["patch", "/api/notifications/preferences"],
  ]) {
    const response = await request(app)[method](path);
    assert.equal(response.status, 401, `${method.toUpperCase()} ${path}`);
  }
});

test("lists only the caller's notifications, newest first, with an unread count", async () => {
  await seed(owner, 3);
  await seed(other, 2);

  const response = await as(owner).get("/api/notifications");

  assert.equal(response.status, 200);
  assert.equal(response.body.unreadCount, 3);
  assert.deepEqual(
    response.body.notifications.map((n) => n.message),
    ["Notification 3", "Notification 2", "Notification 1"],
  );
  assert.equal(response.body.notifications[0].read, false);
  assert.equal(response.body.notifications[0].data.eventTitle, "Meeting 3");
  assert.ok(response.body.notifications[0].createdAt);
  assert.equal(response.body.notifications[0].user, undefined, "owner id is not echoed");
});

test("supports limit, before-cursor and unread-only filters", async () => {
  await seed(owner, 5);

  const firstPage = await as(owner).get("/api/notifications?limit=2");
  assert.deepEqual(
    firstPage.body.notifications.map((n) => n.message),
    ["Notification 5", "Notification 4"],
  );

  const cursor = firstPage.body.notifications[1].id;
  const secondPage = await as(owner).get(`/api/notifications?limit=2&before=${cursor}`);
  assert.deepEqual(
    secondPage.body.notifications.map((n) => n.message),
    ["Notification 3", "Notification 2"],
  );

  const bad = await as(owner).get("/api/notifications?before=not-an-id");
  assert.equal(bad.status, 400);

  await Notification.updateOne({ message: "Notification 5" }, { $set: { readAt: new Date() } });
  const unread = await as(owner).get("/api/notifications?unread=true");
  assert.equal(unread.body.notifications.length, 4);
  assert.equal(unread.body.unreadCount, 4);
});

test("marking one as read updates the unread count; someone else's is a 404", async () => {
  await seed(owner, 2);
  const [target] = (await as(owner).get("/api/notifications")).body.notifications;

  const response = await as(owner).patch(`/api/notifications/${target.id}/read`);
  assert.equal(response.status, 200);
  assert.equal(response.body.notification.read, true);
  assert.equal(response.body.unreadCount, 1);

  const again = await as(owner).patch(`/api/notifications/${target.id}/read`);
  assert.equal(again.status, 200, "marking twice is harmless");
  assert.equal(again.body.unreadCount, 1);

  const foreign = await as(other).patch(`/api/notifications/${target.id}/read`);
  assert.equal(foreign.status, 404);

  const invalid = await as(owner).patch("/api/notifications/not-an-id/read");
  assert.equal(invalid.status, 404);
});

test("read-all only affects the caller", async () => {
  await seed(owner, 3);
  await seed(other, 2);

  const response = await as(owner).post("/api/notifications/read-all");
  assert.equal(response.status, 200);
  assert.equal(response.body.updated, 3);
  assert.equal(response.body.unreadCount, 0);

  const otherList = await as(other).get("/api/notifications");
  assert.equal(otherList.body.unreadCount, 2);
});

test("reminder preference defaults to 15 minutes and accepts only listed values", async () => {
  const initial = await as(owner).get("/api/notifications/preferences");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.preferences.reminderMinutesBefore, 15);
  assert.deepEqual(initial.body.preferences.reminderOptions, [0, 5, 10, 15, 30, 60, 1440]);
  assert.equal(initial.body.preferences.deliveryStatus, "disabled", "queues are not started here");

  for (const invalid of [7, "15", -5, null, 15.5]) {
    const response = await as(owner).patch("/api/notifications/preferences", {
      reminderMinutesBefore: invalid,
    });
    assert.equal(response.status, 400, `rejects ${JSON.stringify(invalid)}`);
  }

  const updated = await as(owner).patch("/api/notifications/preferences", {
    reminderMinutesBefore: 60,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preferences.reminderMinutesBefore, 60);
  assert.equal((await User.findById(owner._id).lean()).reminderMinutesBefore, 60);

  const off = await as(owner).patch("/api/notifications/preferences", { reminderMinutesBefore: 0 });
  assert.equal(off.body.preferences.reminderMinutesBefore, 0);
});

test("notifications created together (one reminder sweep) page without gaps", async () => {
  await createNotifications([1, 2, 3, 4, 5].map((index) => record(owner, index)));

  const seen = [];
  let cursor = "";

  for (let page = 0; page < 5; page += 1) {
    const response = await as(owner).get(`/api/notifications?limit=2${cursor ? `&before=${cursor}` : ""}`);
    seen.push(...response.body.notifications.map((n) => n.message));
    if (response.body.notifications.length < 2) break;
    cursor = response.body.notifications.at(-1).id;
  }

  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);
});

test("duplicate dedupe keys are ignored and old notifications expire after 90 days", async () => {
  const first = await createNotifications([record(owner, 1)]);
  const duplicate = await createNotifications([record(owner, 1), record(owner, 2)]);

  assert.equal(first.length, 1);
  assert.equal(duplicate.length, 1);
  assert.equal(await Notification.countDocuments({ user: owner._id }), 2);

  const indexes = await Notification.collection.indexes();
  const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);
  assert.equal(ttl.expireAfterSeconds, NOTIFICATION_RETENTION_SECONDS);
  assert.ok(indexes.some((index) => index.unique && index.key.dedupeKey === 1));
});
