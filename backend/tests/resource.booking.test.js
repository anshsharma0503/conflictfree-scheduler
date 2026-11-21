import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import Resource from "../src/models/Resource.js";
import User from "../src/models/User.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";

let userA = null;
let userB = null;
let testRoom = null;
let inactiveRoom = null;

before(async () => {
  await connectDatabase();
});

beforeEach(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({
    email: { $in: ["userA@example.com", "userB@example.com"] },
  });

  userA = await User.create({
    name: "User Alpha",
    email: "userA@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  userB = await User.create({
    name: "User Beta",
    email: "userB@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  testRoom = await Resource.create({
    name: "Conference Room 101",
    type: "room",
    capacity: 6,
    location: "Floor 1",
    createdBy: userA._id,
    isActive: true,
  });

  inactiveRoom = await Resource.create({
    name: "Out of Service Room",
    type: "room",
    capacity: 10,
    createdBy: userA._id,
    isActive: false,
  });
});

after(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({
    email: { $in: ["userA@example.com", "userB@example.com"] },
  });
  await disconnectDatabase();
});

function createAuthToken(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
  });
}

test("Event creation with valid active resource associates the resource", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Team Standup",
      startAt: "2026-09-01T10:00:00.000Z",
      endAt: "2026-09-01T11:00:00.000Z",
      resourceId: testRoom._id.toString(),
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.event.resource, testRoom._id.toString());
  assert.equal(response.body.event.resourceDetails.name, "Conference Room 101");
});

test("Event creation when resource is already booked returns 409 Conflict without leaking details", async () => {
  // User A books the room from 10:00 to 11:00
  await Event.create({
    owner: userA._id,
    title: "Secret Executive Strategy Meeting",
    description: "Highly confidential acquisition details",
    startAt: new Date("2026-09-01T10:00:00.000Z"),
    endAt: new Date("2026-09-01T11:00:00.000Z"),
    resource: testRoom._id,
  });

  // User B attempts to book the same room during overlapping time (10:30 to 11:30)
  const tokenB = createAuthToken(userB);

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({
      title: "Design Critique",
      startAt: "2026-09-01T10:30:00.000Z",
      endAt: "2026-09-01T11:30:00.000Z",
      resourceId: testRoom._id.toString(),
    });

  assert.equal(response.status, 409);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /already booked/i);

  // Ensure no private event details leaked
  const responseText = JSON.stringify(response.body);
  assert.ok(!responseText.includes("Secret Executive"));
  assert.ok(!responseText.includes("confidential"));
});

test("Back-to-back resource bookings are valid", async () => {
  // User A books 10:00 to 11:00
  await Event.create({
    owner: userA._id,
    title: "Morning Meeting",
    startAt: new Date("2026-09-01T10:00:00.000Z"),
    endAt: new Date("2026-09-01T11:00:00.000Z"),
    resource: testRoom._id,
  });

  // User B books immediately after from 11:00 to 12:00
  const tokenB = createAuthToken(userB);

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({
      title: "Afternoon Meeting",
      startAt: "2026-09-01T11:00:00.000Z",
      endAt: "2026-09-01T12:00:00.000Z",
      resourceId: testRoom._id.toString(),
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
});

test("Event update excludes current event from resource conflict check", async () => {
  const token = createAuthToken(userA);

  const event = await Event.create({
    owner: userA._id,
    title: "Original Meeting",
    startAt: new Date("2026-09-01T14:00:00.000Z"),
    endAt: new Date("2026-09-01T15:00:00.000Z"),
    resource: testRoom._id,
  });

  const response = await request(app)
    .patch(`/api/events/${event._id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Renamed Meeting",
      startAt: "2026-09-01T14:00:00.000Z",
      endAt: "2026-09-01T15:00:00.000Z",
      resourceId: testRoom._id.toString(),
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.event.title, "Renamed Meeting");
});

test("Event creation rejects inactive resource", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Meeting in broken room",
      startAt: "2026-09-01T10:00:00.000Z",
      endAt: "2026-09-01T11:00:00.000Z",
      resourceId: inactiveRoom._id.toString(),
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /deactivated/i);
});

test("Event creation rejects attendee count exceeding capacity", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Oversized Meeting",
      startAt: "2026-09-01T10:00:00.000Z",
      endAt: "2026-09-01T11:00:00.000Z",
      resourceId: testRoom._id.toString(),
      attendeeCount: 15, // capacity is 6
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /exceeds resource capacity/i);
});

test("POST /api/scheduling/available-slots excludes resource busy intervals", async () => {
  // Room is booked from 14:00 to 16:00
  await Event.create({
    owner: userB._id,
    title: "Another Team's Workshop",
    startAt: new Date("2026-09-01T14:00:00.000Z"),
    endAt: new Date("2026-09-01T16:00:00.000Z"),
    resource: testRoom._id,
  });

  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-09-01T12:00:00.000Z",
      windowEnd: "2026-09-01T18:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      resourceId: testRoom._id.toString(),
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.resource.name, "Conference Room 101");

  const slotTimes = response.body.slots.map((s) => s.startAt);
  // Free: 12:00, 13:00, 16:00, 17:00
  assert.ok(slotTimes.includes("2026-09-01T12:00:00.000Z"));
  assert.ok(slotTimes.includes("2026-09-01T13:00:00.000Z"));
  assert.ok(slotTimes.includes("2026-09-01T16:00:00.000Z"));
  assert.ok(slotTimes.includes("2026-09-01T17:00:00.000Z"));

  // Busy for resource: 14:00 and 15:00
  assert.ok(!slotTimes.includes("2026-09-01T14:00:00.000Z"));
  assert.ok(!slotTimes.includes("2026-09-01T15:00:00.000Z"));
});

test("POST /api/scheduling/available-slots functions normally when resourceId is omitted", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-09-01T12:00:00.000Z",
      windowEnd: "2026-09-01T15:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.resource, undefined);
  assert.equal(response.body.slots.length, 3);
});

test("POST /api/scheduling/suggestions respects resource availability", async () => {
  // Room is booked from 12:00 to 16:00
  await Event.create({
    owner: userB._id,
    title: "Workshop",
    startAt: new Date("2026-09-01T12:00:00.000Z"),
    endAt: new Date("2026-09-01T16:00:00.000Z"),
    resource: testRoom._id,
  });

  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-09-01T12:00:00.000Z",
      windowEnd: "2026-09-01T18:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      resourceId: testRoom._id.toString(),
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.resource.name, "Conference Room 101");

  const suggestionStarts = response.body.suggestions.map((s) => s.startAt);
  for (const start of suggestionStarts) {
    const time = new Date(start).getTime();
    const busyStart = new Date("2026-09-01T12:00:00.000Z").getTime();
    const busyEnd = new Date("2026-09-01T16:00:00.000Z").getTime();
    assert.ok(time < busyStart || time >= busyEnd);
  }
});

