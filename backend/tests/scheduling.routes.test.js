import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const OWNER_ID = "64b7f9ec2f4c1a0012345690";
const OTHER_OWNER_ID = "64b7f9ec2f4c1a0012345691";

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
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    timezone: "Asia/Kolkata",
    location: "Room 301",
    ...overrides,
  });
}

test("POST /api/scheduling/conflicts requires authentication", async () => {
  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .send({
      startAt: "2026-08-20T10:00:00.000Z",
      endAt: "2026-08-20T11:00:00.000Z",
    });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Authentication required",
  });
});

test("POST /api/scheduling/conflicts returns 400 for missing startAt", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({ endAt: "2026-08-20T11:00:00.000Z" });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /startAt is required/);
});

test("POST /api/scheduling/conflicts returns 400 for missing endAt", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({ startAt: "2026-08-20T10:00:00.000Z" });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /endAt is required/);
});

test("POST /api/scheduling/conflicts returns 400 for invalid date string", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({ startAt: "not-a-date", endAt: "2026-08-20T11:00:00.000Z" });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /valid date/);
});

test("POST /api/scheduling/conflicts returns 400 when endAt is before startAt", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T11:00:00.000Z",
      endAt: "2026-08-20T10:00:00.000Z",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /endAt must be after startAt/);
});

test("POST /api/scheduling/conflicts returns 400 when endAt equals startAt", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T10:00:00.000Z",
      endAt: "2026-08-20T10:00:00.000Z",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("POST /api/scheduling/conflicts returns hasConflict false when no existing events", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T10:00:00.000Z",
      endAt: "2026-08-20T11:00:00.000Z",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.hasConflict, false);
  assert.deepEqual(response.body.conflicts, []);
});

test("POST /api/scheduling/conflicts returns hasConflict false for non-overlapping time", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T11:00:00.000Z",
      endAt: "2026-08-20T12:00:00.000Z",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.hasConflict, false);
  assert.deepEqual(response.body.conflicts, []);
});

test("POST /api/scheduling/conflicts returns hasConflict true with conflict details", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    title: "Planning Meeting",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    location: "Room 301",
  });

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T10:30:00.000Z",
      endAt: "2026-08-20T11:30:00.000Z",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.hasConflict, true);
  assert.equal(response.body.conflicts.length, 1);

  const conflict = response.body.conflicts[0];
  assert.ok(conflict.id, "conflict has id");
  assert.equal(conflict.title, "Planning Meeting");
  assert.equal(conflict.startAt, "2026-08-20T10:00:00.000Z");
  assert.equal(conflict.endAt, "2026-08-20T11:00:00.000Z");
  assert.equal(conflict.location, "Room 301");
});

test("POST /api/scheduling/conflicts only returns conflicts belonging to the authenticated user", async () => {
  const token = createAuthToken();

  await Event.create({
    owner: OTHER_OWNER_ID,
    title: "Other User Meeting",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    timezone: "UTC",
  });

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T10:30:00.000Z",
      endAt: "2026-08-20T11:30:00.000Z",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.hasConflict, false);
  assert.deepEqual(response.body.conflicts, []);
});

test("POST /api/scheduling/conflicts with excludeEventId does not treat the event as a conflict with itself", async () => {
  const token = createAuthToken();

  const event = await createExistingEvent({
    title: "Planning Meeting",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T10:00:00.000Z",
      endAt: "2026-08-20T11:00:00.000Z",
      excludeEventId: event.id,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.hasConflict, false);
  assert.deepEqual(response.body.conflicts, []);
});

test("POST /api/scheduling/conflicts with excludeEventId still detects OTHER conflicts", async () => {
  const token = createAuthToken();

  const eventA = await createExistingEvent({
    title: "Event A",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
  });

  await createExistingEvent({
    title: "Event B",
    startAt: "2026-08-20T10:30:00.000Z",
    endAt: "2026-08-20T11:30:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      startAt: "2026-08-20T10:00:00.000Z",
      endAt: "2026-08-20T11:00:00.000Z",
      excludeEventId: eventA.id,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.hasConflict, true);
  assert.equal(response.body.conflicts.length, 1);
  assert.equal(response.body.conflicts[0].title, "Event B");
});
