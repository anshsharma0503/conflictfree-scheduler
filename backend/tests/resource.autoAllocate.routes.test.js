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
let roomA = null;
let roomB = null;

before(async () => {
  await connectDatabase();
});

after(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({
    email: {
      $in: ["auto-alloc-user@example.com", "other-user@example.com"],
    },
  });
  await disconnectDatabase();
});

beforeEach(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({
    email: {
      $in: ["auto-alloc-user@example.com", "other-user@example.com"],
    },
  });

  userA = await User.create({
    name: "Auto Alloc User",
    email: "auto-alloc-user@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  userB = await User.create({
    name: "Other User",
    email: "other-user@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  roomA = await Resource.create({
    name: "Alpha Suite",
    type: "room",
    capacity: 6,
    location: "Floor 1",
    isActive: true,
    createdBy: userA._id,
  });

  roomB = await Resource.create({
    name: "Beta Suite",
    type: "room",
    capacity: 12,
    location: "Floor 2",
    isActive: true,
    createdBy: userA._id,
  });
});

function createAuthToken(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
  });
}

test("POST /api/scheduling/available-slots rejects when both resourceId and autoAllocateResource are present", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-03T09:00:00Z",
      windowEnd: "2026-11-03T18:00:00Z",
      durationMinutes: 60,
      resourceId: roomA._id.toString(),
      autoAllocateResource: true,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(
    response.body.message,
    /Cannot specify both resourceId and autoAllocateResource/,
  );
});

test("POST /api/scheduling/available-slots validates resourceType and attendeeCount", async () => {
  const token = createAuthToken(userA);

  // Invalid resourceType
  const res1 = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-03T09:00:00Z",
      windowEnd: "2026-11-03T18:00:00Z",
      durationMinutes: 60,
      autoAllocateResource: true,
      resourceType: "vehicle",
    });

  assert.equal(res1.status, 400);
  assert.match(
    res1.body.message,
    /resourceType must be either 'room' or 'equipment'/,
  );

  // Invalid attendeeCount
  const res2 = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-03T09:00:00Z",
      windowEnd: "2026-11-03T18:00:00Z",
      durationMinutes: 60,
      autoAllocateResource: true,
      attendeeCount: 0,
    });

  assert.equal(res2.status, 400);
  assert.match(res2.body.message, /Attendee count must be a positive integer/);
});

test("POST /api/scheduling/available-slots with autoAllocateResource allocates free matching resource", async () => {
  const token = createAuthToken(userA);

  // Book Alpha Suite for 09:00 - 11:00 by userB
  await Event.create({
    owner: userB._id,
    title: "Morning Meeting",
    startAt: new Date("2026-11-03T09:00:00Z"),
    endAt: new Date("2026-11-03T11:00:00Z"),
    resource: roomA._id,
  });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-03T09:00:00Z",
      windowEnd: "2026-11-03T12:00:00Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      autoAllocateResource: true,
      resourceType: "room",
      attendeeCount: 5,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.slots.length > 0, true);

  // In 09:00-10:00 and 10:00-11:00, Alpha Suite is busy, so Beta Suite must be allocated!
  const slot9 = response.body.slots.find(
    (s) => s.startAt === "2026-11-03T09:00:00.000Z",
  );
  assert.notEqual(slot9, undefined);
  assert.equal(slot9.allocatedResource.id, roomB._id.toString());
  assert.equal(slot9.allocatedResource.name, "Beta Suite");
  assert.match(slot9.allocationReason, /Beta Suite is active, fits 5 attendees/);

  // In 11:00-12:00, Alpha Suite is free, and because Alpha Suite comes first alphabetically, it is chosen!
  const slot11 = response.body.slots.find(
    (s) => s.startAt === "2026-11-03T11:00:00.000Z",
  );
  assert.notEqual(slot11, undefined);
  assert.equal(slot11.allocatedResource.id, roomA._id.toString());
  assert.equal(slot11.allocatedResource.name, "Alpha Suite");
});

test("POST /api/scheduling/suggestions with autoAllocateResource allocates resource and returns reasons", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-03T09:00:00Z",
      windowEnd: "2026-11-03T12:00:00Z",
      durationMinutes: 60,
      autoAllocateResource: true,
      resourceType: "room",
      attendeeCount: 10,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.suggestions.length > 0, true);

  for (const suggestion of response.body.suggestions) {
    assert.equal(suggestion.allocatedResource.id, roomB._id.toString());
    assert.equal(suggestion.allocatedResource.name, "Beta Suite");
    assert.match(
      suggestion.allocationReason,
      /Beta Suite is active, fits 10 attendees/,
    );
  }
});

test("Manual resourceId continues to work unchanged when autoAllocateResource is not set", async () => {
  const token = createAuthToken(userA);

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-03T09:00:00Z",
      windowEnd: "2026-11-03T12:00:00Z",
      durationMinutes: 60,
      resourceId: roomA._id.toString(),
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.resource.id, roomA._id.toString());
});
