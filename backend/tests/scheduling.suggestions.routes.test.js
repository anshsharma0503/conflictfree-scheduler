import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import User from "../src/models/User.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const OWNER_ID = "64b7f9ec2f4c1a0012345695";
const OTHER_OWNER_ID = "64b7f9ec2f4c1a0012345696";

before(async () => {
  await connectDatabase();
});

beforeEach(async () => {
  await Event.deleteMany({
    owner: {
      $in: [OWNER_ID, OTHER_OWNER_ID],
    },
  });
});

after(async () => {
  await Event.deleteMany({
    owner: {
      $in: [OWNER_ID, OTHER_OWNER_ID],
    },
  });

  await disconnectDatabase();
});

function createAuthToken(user = {}) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  return signAuthToken({
    id: user.id || OWNER_ID,
    email: user.email || "owner@example.com",
    name: user.name || "Owner User",
  });
}

function createExistingEvent(overrides = {}) {
  return Event.create({
    owner: OWNER_ID,
    title: "Planning Meeting",
    description: "Existing event",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
    timezone: "UTC",
    location: "Room 301",
    ...overrides,
  });
}

test("POST /api/scheduling/suggestions returns 401 without auth", async () => {
  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Authentication required",
  });
});

test("POST /api/scheduling/suggestions returns 400 on missing windowStart", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /windowStart is required/);
});

test("POST /api/scheduling/suggestions returns 400 on missing durationMinutes", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /durationMinutes is required/);
});

test("POST /api/scheduling/suggestions returns suggestions with relaxed: false at Level 0", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      preferences: {
        preferredStartHour: 10,
        preferredEndHour: 12,
      },
      minimumScore: 70,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.relaxed, false);
  assert.equal(response.body.relaxationLevel, 0);
  assert.ok(response.body.suggestions.length > 0);
  assert.equal(response.body.suggestions[0].relaxedConstraints.length, 0);
});

test("POST /api/scheduling/suggestions returns relaxed suggestions when strict window is blocked", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T12:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      preferences: {
        preferredStartHour: 10,
        preferredEndHour: 12,
      },
      minimumScore: 70,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.relaxed, true);
  assert.equal(response.body.relaxationLevel, 1);
  assert.ok(response.body.suggestions.length > 0);
  assert.deepEqual(response.body.suggestions[0].relaxedConstraints, [
    "preferredTimeWindow",
  ]);
});

test("POST /api/scheduling/suggestions returns correct relaxationSteps array", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T12:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      preferences: {
        preferredStartHour: 10,
        preferredEndHour: 12,
      },
      minimumScore: 70,
    });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.relaxationSteps));
  assert.equal(response.body.relaxationSteps.length, 2);
  assert.equal(response.body.relaxationSteps[0].level, 0);
  assert.equal(response.body.relaxationSteps[1].level, 1);
});

test("POST /api/scheduling/suggestions respects maxSuggestions parameter", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      maxSuggestions: 2,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.suggestions.length, 2);
});

test("POST /api/scheduling/suggestions returns empty suggestions when entire window is busy", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    startAt: "2026-08-25T09:00:00.000Z",
    endAt: "2026-08-25T17:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.suggestions, []);
});

test("POST /api/scheduling/suggestions includes score and reasons in each suggestion", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T12:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.suggestions.length > 0);
  const first = response.body.suggestions[0];
  assert.equal(typeof first.score, "number");
  assert.ok(Array.isArray(first.reasons));
});

test("POST /api/scheduling/suggestions only considers authenticated user's events", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    owner: OTHER_OWNER_ID,
    startAt: "2026-08-25T09:00:00.000Z",
    endAt: "2026-08-25T17:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T12:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.suggestions.length > 0);
});

test("POST /api/scheduling/suggestions respects multi-participant availability and returns participant summary", async () => {
  const organizer = await User.create({
    email: "sugg.org@example.com",
    name: "Sugg Org",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const participant = await User.create({
    email: "sugg.part@example.com",
    name: "Sugg Part",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  // Participant is busy 09:00 - 11:00 UTC
  const partEvent = await Event.create({
    owner: participant._id,
    title: "Secret Participant Meeting",
    description: "Highly confidential",
    startAt: "2026-08-25T09:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
    timezone: "UTC",
    location: "Secret Bunker",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T13:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      participantEmails: ["sugg.part@example.com"],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(response.body.participants));
  assert.equal(response.body.participants.length, 2);

  const suggestionStarts = response.body.suggestions.map((s) => s.startAt);
  // 09:00 and 10:00 must be excluded because participant is busy
  assert.equal(suggestionStarts.includes("2026-08-25T09:00:00.000Z"), false);
  assert.equal(suggestionStarts.includes("2026-08-25T10:00:00.000Z"), false);
  // 11:00 and 12:00 are available
  assert.ok(suggestionStarts.includes("2026-08-25T11:00:00.000Z"));

  // Verify privacy: no confidential info in response
  const responseJson = JSON.stringify(response.body);
  assert.equal(responseJson.includes("Secret Participant Meeting"), false);
  assert.equal(responseJson.includes("Highly confidential"), false);
  assert.equal(responseJson.includes("Secret Bunker"), false);

  await Event.deleteOne({ _id: partEvent._id });
  await User.deleteMany({ _id: { $in: [organizer._id, participant._id] } });
});

test("POST /api/scheduling/suggestions returns 400 for unknown participant email", async () => {
  const organizer = await User.create({
    email: "sugg.unknown@example.com",
    name: "Sugg Unknown",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/suggestions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T13:00:00.000Z",
      durationMinutes: 60,
      participantEmails: ["missing.colleague@example.com"],
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(
    response.body.message,
    /User not found for participant email: missing.colleague@example.com/,
  );

  await User.deleteOne({ _id: organizer._id });
});

