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

let organizer = null;
let participantA = null;
let participantB = null;
let testRoom = null;

const testEmails = [
  "organizer-j@example.com",
  "participant-a-j@example.com",
  "participant-b-j@example.com",
];

function createToken(user) {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return signAuthToken({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
  });
}

before(async () => {
  await connectDatabase();
});

after(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({ email: { $in: testEmails } });
  await disconnectDatabase();
});

beforeEach(async () => {
  await Event.deleteMany({});
  await Resource.deleteMany({});
  await User.deleteMany({ email: { $in: testEmails } });

  organizer = await User.create({
    name: "Organizer User",
    email: "organizer-j@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  participantA = await User.create({
    name: "Participant Alpha",
    email: "participant-a-j@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  participantB = await User.create({
    name: "Participant Beta",
    email: "participant-b-j@example.com",
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
  });

  testRoom = await Resource.create({
    name: "Phase J Suite",
    type: "room",
    capacity: 6,
    location: "Level 3",
    isActive: true,
    createdBy: organizer._id,
  });
});

test("1. Confirming a valid shared meeting creates one canonical event with pending invitations", async () => {
  const token = createToken(organizer);

  const res = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Quarterly Strategy",
      description: "Q1 alignment",
      startAt: "2026-11-10T10:00:00.000Z",
      endAt: "2026-11-10T11:00:00.000Z",
      participantEmails: [participantA.email, participantB.email],
      resourceId: testRoom._id.toString(),
      attendeeCount: 3,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  const meeting = res.body.meeting;
  assert.equal(meeting.title, "Quarterly Strategy");
  assert.equal(meeting.owner, organizer._id.toString());
  assert.equal(meeting.status, "active");
  assert.equal(meeting.participants.length, 2);

  // Requirement 2: All invitations begin pending
  for (const p of meeting.participants) {
    assert.equal(p.status, "pending");
    assert.equal(p.respondedAt, null);
  }

  // Verify only 1 canonical document exists in MongoDB
  const count = await Event.countDocuments({});
  assert.equal(count, 1);
});

test("3. Organizer cannot be duplicated in participants", async () => {
  const token = createToken(organizer);

  const res = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Team Sync",
      startAt: "2026-11-10T10:00:00.000Z",
      endAt: "2026-11-10T11:00:00.000Z",
      // Include organizer email in list
      participantEmails: [organizer.email, participantA.email],
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.meeting.participants.length, 1);
  assert.equal(res.body.meeting.participants[0].email, participantA.email);
  assert.equal(
    res.body.meeting.participants.some(
      (p) => p.email === organizer.email || p.user === organizer._id.toString(),
    ),
    false,
  );
});

test("4. Unknown participant email is rejected with HTTP 400", async () => {
  const token = createToken(organizer);

  const res = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Client Sync",
      startAt: "2026-11-10T10:00:00.000Z",
      endAt: "2026-11-10T11:00:00.000Z",
      participantEmails: ["ghost@example.com"],
    });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /User not found for participant email/);
});

test("5. Participant conflict at confirmation returns 409 without leaking private event data", async () => {
  // Participant A already has a personal meeting during this time
  await Event.create({
    owner: participantA._id,
    title: "Confidential 1-on-1",
    description: "Private conversation details",
    startAt: new Date("2026-11-10T10:30:00.000Z"),
    endAt: new Date("2026-11-10T11:30:00.000Z"),
  });

  const token = createToken(organizer);

  const res = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Product Review",
      startAt: "2026-11-10T10:00:00.000Z",
      endAt: "2026-11-10T11:00:00.000Z",
      participantEmails: [participantA.email],
    });

  assert.equal(res.status, 409);
  assert.equal(
    res.body.message,
    "One or more participants are no longer available for the requested time",
  );
  // Ensure private title or description was NOT leaked
  assert.equal(JSON.stringify(res.body).includes("Confidential"), false);
  assert.equal(JSON.stringify(res.body).includes("Private conversation"), false);
});

test("6. Resource conflict/capacity failure returns 409/400 correctly", async () => {
  const token = createToken(organizer);

  // A. Capacity failure: room capacity is 6, requested attendees is 10
  const capRes = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "All Hands",
      startAt: "2026-11-10T10:00:00.000Z",
      endAt: "2026-11-10T11:00:00.000Z",
      participantEmails: [participantA.email],
      resourceId: testRoom._id.toString(),
      attendeeCount: 10,
    });

  assert.equal(capRes.status, 400);
  assert.match(capRes.body.message, /exceeds resource capacity/);

  // B. Resource double-booking conflict
  await Event.create({
    owner: participantB._id,
    title: "Executive Session",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    resource: testRoom._id,
  });

  const conflictRes = await request(app)
    .post("/api/meetings/confirm")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Another Team",
      startAt: "2026-11-10T10:30:00.000Z",
      endAt: "2026-11-10T11:30:00.000Z",
      participantEmails: [participantA.email],
      resourceId: testRoom._id.toString(),
      attendeeCount: 4,
    });

  assert.equal(conflictRes.status, 409);
  assert.match(conflictRes.body.message, /Resource is already booked/);
});

test("7. Pending invitation blocks participant availability in slot finder", async () => {
  // Confirm meeting with pending invitation for Participant A
  await Event.create({
    owner: organizer._id,
    title: "Pending Sync",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "pending",
      },
    ],
    status: "active",
  });

  // Organizer searches slots involving Participant A
  const token = createToken(organizer);
  const res = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-10T09:00:00.000Z",
      windowEnd: "2026-11-10T12:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      participantEmails: [participantA.email],
    });

  assert.equal(res.status, 200);
  const slots = res.body.slots;
  // 10:00-11:00 should NOT be available
  assert.equal(
    slots.some((s) => s.startAt === "2026-11-10T10:00:00.000Z"),
    false,
  );
  // 09:00-10:00 and 11:00-12:00 SHOULD be available
  assert.equal(
    slots.some((s) => s.startAt === "2026-11-10T09:00:00.000Z"),
    true,
  );
  assert.equal(
    slots.some((s) => s.startAt === "2026-11-10T11:00:00.000Z"),
    true,
  );
});

test("8. Accepted invitation blocks participant availability in slot finder", async () => {
  // Participant A has accepted a meeting
  await Event.create({
    owner: organizer._id,
    title: "Accepted Standup",
    startAt: new Date("2026-11-10T14:00:00.000Z"),
    endAt: new Date("2026-11-10T15:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "accepted",
        respondedAt: new Date(),
      },
    ],
    status: "active",
  });

  const token = createToken(organizer);
  const res = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-10T13:00:00.000Z",
      windowEnd: "2026-11-10T16:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      participantEmails: [participantA.email],
    });

  assert.equal(res.status, 200);
  const slots = res.body.slots;
  // 14:00-15:00 must be blocked
  assert.equal(
    slots.some((s) => s.startAt === "2026-11-10T14:00:00.000Z"),
    false,
  );
  assert.equal(
    slots.some((s) => s.startAt === "2026-11-10T13:00:00.000Z"),
    true,
  );
});

test("9. Declined invitation does not block participant availability", async () => {
  // Participant B invited Participant A, but Participant A declined for 10:00-11:00
  await Event.create({
    owner: participantB._id,
    title: "Declined Workshop",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "declined",
        respondedAt: new Date(),
      },
    ],
    status: "active",
  });

  const token = createToken(organizer);
  const res = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-10T10:00:00.000Z",
      windowEnd: "2026-11-10T11:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      participantEmails: [participantA.email],
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.slots.length, 1);
  assert.equal(res.body.slots[0].startAt, "2026-11-10T10:00:00.000Z");
});

test("10. Cancelled meeting blocks neither participants nor resource", async () => {
  // Cancelled meeting with Participant A and testRoom for 10:00-11:00
  await Event.create({
    owner: organizer._id,
    title: "Cancelled Retrospective",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "accepted",
      },
    ],
    resource: testRoom._id,
    status: "cancelled",
  });

  const token = createToken(organizer);
  const res = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-11-10T10:00:00.000Z",
      windowEnd: "2026-11-10T11:00:00.000Z",
      durationMinutes: 60,
      resourceId: testRoom._id.toString(),
      participantEmails: [participantA.email],
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.slots.length, 1);
  assert.equal(res.body.slots[0].startAt, "2026-11-10T10:00:00.000Z");
});

test("11. Invitee can view invitation in inbox and event details, but cannot edit or cancel organizer meeting", async () => {
  const meeting = await Event.create({
    owner: organizer._id,
    title: "Architecture Review",
    description: "Design discussion",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "pending",
      },
    ],
    status: "active",
  });

  const inviteeToken = createToken(participantA);

  // A. View in invitations inbox
  const inboxRes = await request(app)
    .get("/api/meetings/invitations")
    .set("Authorization", `Bearer ${inviteeToken}`);

  assert.equal(inboxRes.status, 200);
  assert.equal(inboxRes.body.invitations.length, 1);
  assert.equal(inboxRes.body.invitations[0].id, meeting._id.toString());
  assert.equal(inboxRes.body.invitations[0].organizer.email, organizer.email);

  // B. View in event list
  const listRes = await request(app)
    .get("/api/events")
    .set("Authorization", `Bearer ${inviteeToken}`);

  assert.equal(listRes.status, 200);
  assert.equal(
    listRes.body.events.some((e) => e.id === meeting._id.toString()),
    true,
  );

  // C. View single event by id
  const getRes = await request(app)
    .get(`/api/events/${meeting._id}`)
    .set("Authorization", `Bearer ${inviteeToken}`);

  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.event.id, meeting._id.toString());

  // D. Attempt to edit meeting as invitee -> HTTP 403 Forbidden
  const editRes = await request(app)
    .patch(`/api/events/${meeting._id}`)
    .set("Authorization", `Bearer ${inviteeToken}`)
    .send({ title: "Hacked Title" });

  assert.equal(editRes.status, 403);
  assert.match(editRes.body.message, /Only the organizer can edit/);

  // E. Attempt to delete/cancel meeting as invitee -> HTTP 403 Forbidden
  const deleteRes = await request(app)
    .delete(`/api/events/${meeting._id}`)
    .set("Authorization", `Bearer ${inviteeToken}`);

  assert.equal(deleteRes.status, 403);
  assert.match(deleteRes.body.message, /Only the organizer can delete/);

  const cancelRes = await request(app)
    .post(`/api/meetings/${meeting._id}/cancel`)
    .set("Authorization", `Bearer ${inviteeToken}`);

  assert.equal(cancelRes.status, 403);
  assert.match(cancelRes.body.message, /Only the organizer can cancel/);
});

test("12. Only invitee can accept/decline their own invitation", async () => {
  const meeting = await Event.create({
    owner: organizer._id,
    title: "1-on-1 Review",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "pending",
      },
    ],
    status: "active",
  });

  // A. Non-invited user (Participant B) cannot respond -> HTTP 403
  const tokenB = createToken(participantB);
  const uninvitedRes = await request(app)
    .patch(`/api/meetings/${meeting._id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenB}`)
    .send({ status: "accepted" });

  assert.equal(uninvitedRes.status, 403);
  assert.match(uninvitedRes.body.message, /not invited/);

  // B. Organizer cannot respond to own invitation -> HTTP 400
  const organizerToken = createToken(organizer);
  const orgRes = await request(app)
    .patch(`/api/meetings/${meeting._id}/invitation-response`)
    .set("Authorization", `Bearer ${organizerToken}`)
    .send({ status: "accepted" });

  assert.equal(orgRes.status, 400);
  assert.match(orgRes.body.message, /Organizer cannot respond/);

  // C. Invited participant A responds successfully
  const tokenA = createToken(participantA);
  const acceptRes = await request(app)
    .patch(`/api/meetings/${meeting._id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ status: "accepted" });

  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.success, true);
  const updatedMeeting = acceptRes.body.meeting;
  assert.equal(updatedMeeting.participants[0].status, "accepted");
  assert.notEqual(updatedMeeting.participants[0].respondedAt, null);

  // D. Second response is rejected (only pending -> accepted/declined is valid)
  const duplicateRes = await request(app)
    .patch(`/api/meetings/${meeting._id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ status: "declined" });

  assert.equal(duplicateRes.status, 400);
  assert.match(duplicateRes.body.message, /already been responded to/);
});

test("13. Accept after a newly created conflict returns 409", async () => {
  const meeting = await Event.create({
    owner: organizer._id,
    title: "Product Sync",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "pending",
      },
    ],
    status: "active",
  });

  // Participant A creates a personal conflicting meeting in the meantime
  await Event.create({
    owner: participantA._id,
    title: "Urgent Client Call",
    startAt: new Date("2026-11-10T10:15:00.000Z"),
    endAt: new Date("2026-11-10T10:45:00.000Z"),
    status: "active",
  });

  // Participant A tries to accept the pending invitation
  const tokenA = createToken(participantA);
  const res = await request(app)
    .patch(`/api/meetings/${meeting._id}/invitation-response`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ status: "accepted" });

  assert.equal(res.status, 409);
  assert.match(res.body.message, /conflicting event/);
});

test("14. Organizer-only cancellation sets status to cancelled and preserves document", async () => {
  const meeting = await Event.create({
    owner: organizer._id,
    title: "Sprint Planning",
    startAt: new Date("2026-11-10T10:00:00.000Z"),
    endAt: new Date("2026-11-10T11:00:00.000Z"),
    participants: [
      {
        user: participantA._id,
        email: participantA.email,
        name: participantA.name,
        status: "pending",
      },
    ],
    status: "active",
  });

  const orgToken = createToken(organizer);

  const res = await request(app)
    .post(`/api/meetings/${meeting._id}/cancel`)
    .set("Authorization", `Bearer ${orgToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.meeting.status, "cancelled");

  // Document still exists in database (soft status update)
  const persisted = await Event.findById(meeting._id);
  assert.notEqual(persisted, null);
  assert.equal(persisted.status, "cancelled");

  // Attempting to cancel already cancelled meeting returns HTTP 400
  const secondRes = await request(app)
    .post(`/api/meetings/${meeting._id}/cancel`)
    .set("Authorization", `Bearer ${orgToken}`);

  assert.equal(secondRes.status, 400);
  assert.match(secondRes.body.message, /already cancelled/);
});

test("15. Existing personal events without participants continue to work exactly as before", async () => {
  const token = createToken(organizer);

  // A. Create personal event via standard POST /api/events
  const createRes = await request(app)
    .post("/api/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Solo Deep Work",
      description: "Focus time",
      startAt: "2026-11-12T09:00:00.000Z",
      endAt: "2026-11-12T11:00:00.000Z",
      timezone: "UTC",
      location: "Home Office",
    });

  assert.equal(createRes.status, 201);
  const createdEvent = createRes.body.event;
  assert.equal(createdEvent.title, "Solo Deep Work");
  assert.equal(createdEvent.status, "active");
  assert.equal(createdEvent.participants.length, 0);

  // B. Update personal event
  const updateRes = await request(app)
    .patch(`/api/events/${createdEvent.id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Updated Deep Work",
    });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.event.title, "Updated Deep Work");

  // C. Delete personal event
  const deleteRes = await request(app)
    .delete(`/api/events/${createdEvent.id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);
});
