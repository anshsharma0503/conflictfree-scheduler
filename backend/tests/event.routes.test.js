import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import { signAuthToken } from "../src/services/tokenService.js";

const TEST_JWT_SECRET = "test-secret";
const OWNER_ID = "64b7f9ec2f4c1a0012345678";
const OTHER_OWNER_ID = "64b7f9ec2f4c1a0012345679";

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

function createValidEventPayload(overrides = {}) {
  return {
    title: "Planning Meeting",
    description: "Discuss roadmap",
    startAt: "2026-08-15T10:00:00.000Z",
    endAt: "2026-08-15T11:00:00.000Z",
    timezone: "Asia/Kolkata",
    location: "Room 301",
    ...overrides,
  };
}

test("POST /api/events requires authentication", async () => {
  const response = await request(app)
    .post("/api/events")
    .send(createValidEventPayload());

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Authentication required",
  });
});

test("GET /api/events requires authentication", async () => {
  const response = await request(app).get("/api/events");

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Authentication required",
  });
});

test("POST /api/events creates an event for the authenticated user", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send(createValidEventPayload());

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.event.title, "Planning Meeting");
  assert.equal(response.body.event.owner, OWNER_ID);
  assert.deepEqual(response.body.event.participants, []);
});

test("POST /api/events accepts an explicit empty participants array for backward compatibility", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send(createValidEventPayload({ participants: [] }));

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.event.participants, []);
});

test("POST /api/events rejects client-supplied participants (invitations must use /api/meetings/confirm)", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send(
      createValidEventPayload({
        participants: [
          { user: OTHER_OWNER_ID, email: "victim@example.com", status: "accepted" },
        ],
      }),
    );

  assert.equal(response.status, 400);
  assert.match(response.body.message, /\/api\/meetings\/confirm/);
  assert.equal(await Event.countDocuments({ owner: OWNER_ID }), 0);
});

test("PATCH /api/events/:id rejects participant changes", async () => {
  const event = await Event.create({
    owner: OWNER_ID,
    title: "Solo",
    startAt: new Date("2026-08-15T10:00:00.000Z"),
    endAt: new Date("2026-08-15T11:00:00.000Z"),
  });

  const response = await request(app)
    .patch(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${createAuthToken()}`)
    .send({ participants: [{ email: "x@example.com" }] });

  assert.equal(response.status, 400);
  const stored = await Event.findById(event.id);
  assert.equal(stored.participants.length, 0);
});

test("events listing a user only by free-text participant email are not visible to that user", async () => {
  // Legacy/hand-crafted data: participant entry without a verified user ref.
  await Event.create({
    owner: OTHER_OWNER_ID,
    title: "Private planning of someone else",
    startAt: new Date("2026-08-15T10:00:00.000Z"),
    endAt: new Date("2026-08-15T11:00:00.000Z"),
    participants: [{ user: null, email: "owner@example.com", status: "pending" }],
  });

  const response = await request(app)
    .get("/api/events")
    .set("Authorization", `Bearer ${createAuthToken()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.events.length, 0);
});

test("malformed JSON bodies get a JSON 400 response, not an HTML error page", async () => {
  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${createAuthToken()}`)
    .set("Content-Type", "application/json")
    .send('{"title": ');

  assert.equal(response.status, 400);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.deepEqual(response.body, {
    success: false,
    message: "Request body must be valid JSON",
  });
});

test("unknown API routes return JSON 404", async () => {
  const response = await request(app).get("/api/does-not-exist");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { success: false, message: "API route not found" });
});

test("POST /api/events returns validation error for invalid event", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send(
      createValidEventPayload({
        startAt: "2026-08-15T11:00:00.000Z",
        endAt: "2026-08-15T10:00:00.000Z",
      }),
    );

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("GET /api/events returns only authenticated user's events sorted by startAt", async () => {
  const token = createAuthToken();

  await Event.create({
    owner: OWNER_ID,
    ...createValidEventPayload({
      title: "Later Meeting",
      startAt: "2026-08-15T12:00:00.000Z",
      endAt: "2026-08-15T13:00:00.000Z",
    }),
  });

  await Event.create({
    owner: OWNER_ID,
    ...createValidEventPayload({
      title: "Earlier Meeting",
      startAt: "2026-08-15T09:00:00.000Z",
      endAt: "2026-08-15T10:00:00.000Z",
    }),
  });

  await Event.create({
    owner: OTHER_OWNER_ID,
    ...createValidEventPayload({
      title: "Other User Meeting",
    }),
  });

  const response = await request(app)
    .get("/api/events")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.events.length, 2);
  assert.equal(response.body.events[0].title, "Earlier Meeting");
  assert.equal(response.body.events[1].title, "Later Meeting");
});

test("GET /api/events/:id returns one owned event", async () => {
  const token = createAuthToken();

  const event = await Event.create({
    owner: OWNER_ID,
    ...createValidEventPayload(),
  });

  const response = await request(app)
    .get(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.event.id, event.id);
});

test("GET /api/events/:id returns 404 for another user's event", async () => {
  const token = createAuthToken();

  const event = await Event.create({
    owner: OTHER_OWNER_ID,
    ...createValidEventPayload(),
  });

  const response = await request(app)
    .get(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    success: false,
    message: "Event not found",
  });
});

test("PATCH /api/events/:id updates an owned event", async () => {
  const token = createAuthToken();

  const event = await Event.create({
    owner: OWNER_ID,
    ...createValidEventPayload(),
  });

  const response = await request(app)
    .patch(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Updated Meeting",
      location: "Room 404",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.event.title, "Updated Meeting");
  assert.equal(response.body.event.location, "Room 404");
});

test("PATCH /api/events/:id rejects invalid event updates", async () => {
  const token = createAuthToken();

  const event = await Event.create({
    owner: OWNER_ID,
    ...createValidEventPayload(),
  });

  const response = await request(app)
    .patch(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      endAt: "2026-08-15T09:00:00.000Z",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
});

test("DELETE /api/events/:id deletes an owned event", async () => {
  const token = createAuthToken();

  const event = await Event.create({
    owner: OWNER_ID,
    ...createValidEventPayload(),
  });

  const response = await request(app)
    .delete(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    message: "Event deleted successfully",
  });

  const deletedEvent = await Event.findById(event.id);

  assert.equal(deletedEvent, null);
});

test("DELETE /api/events/:id returns 404 for another user's event", async () => {
  const token = createAuthToken();

  const event = await Event.create({
    owner: OTHER_OWNER_ID,
    ...createValidEventPayload(),
  });

  const response = await request(app)
    .delete(`/api/events/${event.id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    success: false,
    message: "Event not found",
  });
}); 