// Regression tests for issues found in the pre-Phase-L audit:
// - conflict checks must include invitations the user holds
// - moving a shared meeting must re-check participant availability atomically
// - cancelled meetings are read-only
// - invitations/visibility are matched by verified user id, never by free-text email
import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import User from "../src/models/User.js";
import { signAuthToken } from "../src/services/tokenService.js";

const emails = ["audit-org@example.com", "audit-a@example.com", "audit-b@example.com"];
let organizer;
let alpha;
let beta;

function tokenFor(user) {
  process.env.JWT_SECRET = "test-secret";
  return signAuthToken({ id: user._id.toString(), email: user.email, name: user.name });
}

function createUser(name, email) {
  return User.create({
    name,
    email,
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });
}

async function confirmMeeting(startAt, endAt, participantEmails) {
  const res = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({ title: "Audit Sync", startAt, endAt, participantEmails });
  assert.equal(res.status, 201, res.body.message);
  return res.body.meeting;
}

before(async () => {
  await connectDatabase();
});

beforeEach(async () => {
  await Event.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });
  organizer = await createUser("Audit Organizer", emails[0]);
  alpha = await createUser("Audit Alpha", emails[1]);
  beta = await createUser("Audit Beta", emails[2]);
});

after(async () => {
  await Event.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });
  await disconnectDatabase();
});

test("POST /api/scheduling/conflicts reports meetings the user has accepted or not yet answered", async () => {
  const meeting = await confirmMeeting(
    "2026-12-01T10:00:00.000Z",
    "2026-12-01T11:00:00.000Z",
    [alpha.email],
  );

  const pending = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${tokenFor(alpha)}`)
    .send({ startAt: "2026-12-01T10:30:00.000Z", endAt: "2026-12-01T11:30:00.000Z" });

  assert.equal(pending.status, 200);
  assert.equal(pending.body.hasConflict, true);
  assert.equal(pending.body.conflicts[0].id, meeting.id);

  await request(app)
    .patch(`/api/meetings/${meeting.id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenFor(alpha)}`)
    .send({ status: "declined" })
    .expect(200);

  const declined = await request(app)
    .post("/api/scheduling/conflicts")
    .set("Authorization", `Bearer ${tokenFor(alpha)}`)
    .send({ startAt: "2026-12-01T10:30:00.000Z", endAt: "2026-12-01T11:30:00.000Z" });

  assert.equal(declined.body.hasConflict, false);
});

test("moving a shared meeting onto a participant's busy time is rejected with 409 and nothing changes", async () => {
  const meeting = await confirmMeeting(
    "2026-12-02T10:00:00.000Z",
    "2026-12-02T11:00:00.000Z",
    [alpha.email],
  );

  await Event.create({
    owner: alpha._id,
    title: "Alpha private dentist appointment",
    startAt: new Date("2026-12-02T14:00:00.000Z"),
    endAt: new Date("2026-12-02T15:00:00.000Z"),
  });

  const res = await request(app)
    .patch(`/api/events/${meeting.id}`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({ startAt: "2026-12-02T14:30:00.000Z", endAt: "2026-12-02T15:30:00.000Z" });

  assert.equal(res.status, 409);
  assert.doesNotMatch(res.body.message, /dentist/i, "must not leak private event details");

  const stored = await Event.findById(meeting.id);
  assert.equal(stored.startAt.toISOString(), "2026-12-02T10:00:00.000Z");
});

test("moving a shared meeting is allowed when only a declined participant is busy, and back-to-back is fine", async () => {
  const meeting = await confirmMeeting(
    "2026-12-03T10:00:00.000Z",
    "2026-12-03T11:00:00.000Z",
    [alpha.email, beta.email],
  );

  await request(app)
    .patch(`/api/meetings/${meeting.id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenFor(beta)}`)
    .send({ status: "declined" })
    .expect(200);

  await Event.create({
    owner: beta._id,
    title: "Beta busy",
    startAt: new Date("2026-12-03T14:00:00.000Z"),
    endAt: new Date("2026-12-03T15:00:00.000Z"),
  });
  await Event.create({
    owner: alpha._id,
    title: "Alpha earlier block",
    startAt: new Date("2026-12-03T13:00:00.000Z"),
    endAt: new Date("2026-12-03T14:00:00.000Z"),
  });

  const res = await request(app)
    .patch(`/api/events/${meeting.id}`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({ startAt: "2026-12-03T14:00:00.000Z", endAt: "2026-12-03T15:00:00.000Z" });

  assert.equal(res.status, 200, res.body.message);
  assert.equal(res.body.event.startAt, "2026-12-03T14:00:00.000Z");
});

test("a cancelled meeting cannot be edited", async () => {
  const meeting = await confirmMeeting(
    "2026-12-04T10:00:00.000Z",
    "2026-12-04T11:00:00.000Z",
    [alpha.email],
  );

  await request(app)
    .post(`/api/meetings/${meeting.id}/cancel`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .expect(200);

  const res = await request(app)
    .patch(`/api/events/${meeting.id}`)
    .set("Authorization", `Bearer ${tokenFor(organizer)}`)
    .send({ title: "Revived" });

  assert.equal(res.status, 400);
  assert.equal((await Event.findById(meeting.id)).title, "Audit Sync");
});

test("an invitation entry that only names a user's email (no verified user id) never reaches their inbox", async () => {
  await Event.create({
    owner: organizer._id,
    title: "Spoofed invitation",
    startAt: new Date("2026-12-05T10:00:00.000Z"),
    endAt: new Date("2026-12-05T11:00:00.000Z"),
    participants: [{ user: null, email: alpha.email, status: "pending" }],
  });

  const inbox = await request(app)
    .get("/api/meetings/invitations")
    .set("Authorization", `Bearer ${tokenFor(alpha)}`);

  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.invitations.length, 0);

  const spoofed = await Event.findOne({ title: "Spoofed invitation" });
  const respond = await request(app)
    .patch(`/api/meetings/${spoofed.id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenFor(alpha)}`)
    .send({ status: "accepted" });

  assert.equal(respond.status, 403);
});
