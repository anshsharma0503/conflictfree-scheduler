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
const OWNER_ID = "64b7f9ec2f4c1a0012345692";
const OTHER_OWNER_ID = "64b7f9ec2f4c1a0012345693";


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
    timezone: "Asia/Kolkata",
    location: "Room 301",
    ...overrides,
  });
}

test("POST /api/scheduling/available-slots requires authentication", async () => {
  const response = await request(app)
    .post("/api/scheduling/available-slots")
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

test("POST /api/scheduling/available-slots returns 400 for missing windowStart", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /windowStart is required/);
});

test("POST /api/scheduling/available-slots returns 400 for missing windowEnd", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /windowEnd is required/);
});

test("POST /api/scheduling/available-slots returns 400 for invalid dates", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "not-a-date",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /valid date/);
});

test("POST /api/scheduling/available-slots returns 400 when windowEnd is before or equal to windowStart", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T17:00:00.000Z",
      windowEnd: "2026-08-25T09:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /windowEnd must be after windowStart/);
});

test("POST /api/scheduling/available-slots returns 400 for missing or invalid durationMinutes", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T17:00:00.000Z",
      durationMinutes: -10,
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /durationMinutes must be positive/);
});

test("POST /api/scheduling/available-slots returns available slots when no events exist", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T11:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 30,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.slots.length, 3);
  assert.equal(response.body.slots[0].startAt, "2026-08-25T09:00:00.000Z");
  assert.equal(response.body.slots[0].endAt, "2026-08-25T10:00:00.000Z");
  assert.equal(response.body.slots[1].startAt, "2026-08-25T09:30:00.000Z");
  assert.equal(response.body.slots[1].endAt, "2026-08-25T10:30:00.000Z");
  assert.equal(response.body.slots[2].startAt, "2026-08-25T10:00:00.000Z");
  assert.equal(response.body.slots[2].endAt, "2026-08-25T11:00:00.000Z");
});

test("POST /api/scheduling/available-slots excludes slots that overlap existing events", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T13:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 30,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const slotStrings = response.body.slots.map((s) => `${s.startAt} -> ${s.endAt}`);
  assert.deepEqual(slotStrings, [
    "2026-08-25T09:00:00.000Z -> 2026-08-25T10:00:00.000Z",
    "2026-08-25T11:00:00.000Z -> 2026-08-25T12:00:00.000Z",
    "2026-08-25T11:30:00.000Z -> 2026-08-25T12:30:00.000Z",
    "2026-08-25T12:00:00.000Z -> 2026-08-25T13:00:00.000Z",
  ]);
});

test("POST /api/scheduling/available-slots only considers authenticated user's events", async () => {
  const token = createAuthToken();

  await Event.create({
    owner: OTHER_OWNER_ID,
    title: "Other User Meeting",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
    timezone: "UTC",
  });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T11:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 30,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.slots.length, 3);
});

test("POST /api/scheduling/available-slots returns empty when no slot fits", async () => {
  const token = createAuthToken();

  await createExistingEvent({
    startAt: "2026-08-25T09:00:00.000Z",
    endAt: "2026-08-25T12:00:00.000Z",
  });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T12:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 30,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.slots, []);
});

test("POST /api/scheduling/available-slots includes score and reasons in each slot", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T11:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.slots.length > 0);

  for (const slot of response.body.slots) {
    assert.equal(typeof slot.score, "number");
    assert.ok(Array.isArray(slot.reasons));
  }
});

test("POST /api/scheduling/available-slots ranks preferred afternoon slots ahead of morning slots", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T18:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      preferences: {
        preferredStartHour: 13,
        preferredEndHour: 17,
        avoidEarlyMorning: true,
        avoidLateDay: true,
      },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const slots = response.body.slots;
  assert.ok(slots.length >= 4);

  const topSlot = slots[0];
  const topStart = new Date(topSlot.startAt);
  assert.ok(topStart.getUTCHours() >= 13 && topStart.getUTCHours() < 17);
  assert.ok(topSlot.reasons.includes("Inside preferred time window"));
  assert.ok(topSlot.score >= 80);

  const slot09 = slots.find((s) => new Date(s.startAt).getUTCHours() === 9);
  assert.ok(slot09);
  assert.ok(topSlot.score > slot09.score);
});


test("POST /api/scheduling/available-slots applies earliestSlotBonus when enabled", async () => {
  const token = createAuthToken();

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T11:00:00.000Z",
      windowEnd: "2026-08-25T14:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      preferences: {
        earliestSlotBonus: true,
      },
    });

  assert.equal(response.status, 200);
  const slots = response.body.slots;
  assert.equal(slots.length, 3);

  assert.equal(slots[0].score, 60); // 50 base + 10 bonus
  assert.ok(slots[0].reasons.includes("Earliest slot bonus"));
  assert.equal(slots[1].score, 58); // 50 base + 8 bonus
  assert.equal(slots[2].score, 56); // 50 base + 6 bonus
});

test("POST /api/scheduling/available-slots respects user's configured timezone from database", async () => {
  const user = await User.create({
    email: "kolkata.slots.user@example.com",
    name: "Kolkata User",
    timezone: "Asia/Kolkata",
    passwordHash: "hash123",
  });

  const token = createAuthToken({ id: user.id, email: user.email, name: user.name });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-09-26T05:00:00.000Z",
      windowEnd: "2026-09-26T07:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 30,
      preferences: {
        avoidEarlyMorning: true,
      },
    });

  assert.equal(response.status, 200);
  const slots = response.body.slots;
  assert.ok(slots.length > 0);
  assert.ok(slots[0].reasons.includes("Avoids early morning"));
  assert.equal(slots[0].reasons.includes("Early morning penalty"), false);

  await User.deleteOne({ _id: user._id });
});

test("POST /api/scheduling/available-slots returns participants summary and preserves single-user when participantEmails omitted", async () => {
  const organizer = await User.create({
    email: "multi.org1@example.com",
    name: "Multi Org 1",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T12:00:00.000Z",
      durationMinutes: 60,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(response.body.participants));
  assert.equal(response.body.participants.length, 1);
  assert.equal(response.body.participants[0].email, "multi.org1@example.com");
  assert.equal(response.body.participants[0].name, "Multi Org 1");
  assert.ok(Array.isArray(response.body.slots));
  assert.ok(response.body.slots.length > 0);

  await User.deleteOne({ _id: organizer._id });
});

test("POST /api/scheduling/available-slots excludes slot free for organizer but busy for selected participant", async () => {
  const organizer = await User.create({
    email: "org.free@example.com",
    name: "Organizer Free",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const participant = await User.create({
    email: "part.busy@example.com",
    name: "Participant Busy",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  // Participant is busy from 10:00 to 11:00 UTC
  const partEvent = await Event.create({
    owner: participant._id,
    title: "Participant Private Doctor Visit",
    description: "Confidential medical appointment",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
    timezone: "UTC",
    location: "Clinic",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T13:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      participantEmails: ["part.busy@example.com"],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.participants.length, 2);

  const slotStarts = response.body.slots.map((s) => s.startAt);
  // 09:00 - 10:00 is free
  assert.ok(slotStarts.includes("2026-08-25T09:00:00.000Z"));
  // 10:00 - 11:00 MUST be excluded because participant is busy
  assert.equal(slotStarts.includes("2026-08-25T10:00:00.000Z"), false);
  // 11:00 - 12:00 is free (back-to-back allowed)
  assert.ok(slotStarts.includes("2026-08-25T11:00:00.000Z"));
  // 12:00 - 13:00 is free
  assert.ok(slotStarts.includes("2026-08-25T12:00:00.000Z"));

  // Verify privacy: participant event title and description are NOT anywhere in response
  const responseText = JSON.stringify(response.body);
  assert.equal(responseText.includes("Participant Private Doctor Visit"), false);
  assert.equal(responseText.includes("Confidential medical appointment"), false);
  assert.equal(responseText.includes("Clinic"), false);

  await Event.deleteOne({ _id: partEvent._id });
  await User.deleteMany({ _id: { $in: [organizer._id, participant._id] } });
});

test("POST /api/scheduling/available-slots combines busy ranges across multiple participants correctly", async () => {
  const organizer = await User.create({
    email: "multi.org2@example.com",
    name: "Organizer Two",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const part1 = await User.create({
    email: "multi.part1@example.com",
    name: "Part One",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const part2 = await User.create({
    email: "multi.part2@example.com",
    name: "Part Two",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  // Organizer busy 09:00 - 10:00
  const orgEv = await Event.create({
    owner: organizer._id,
    title: "Org Busy",
    startAt: "2026-08-25T09:00:00.000Z",
    endAt: "2026-08-25T10:00:00.000Z",
    timezone: "UTC",
  });

  // Part 1 busy 10:00 - 11:00
  const p1Ev = await Event.create({
    owner: part1._id,
    title: "P1 Busy",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
    timezone: "UTC",
  });

  // Part 2 busy 12:00 - 13:00
  const p2Ev = await Event.create({
    owner: part2._id,
    title: "P2 Busy",
    startAt: "2026-08-25T12:00:00.000Z",
    endAt: "2026-08-25T13:00:00.000Z",
    timezone: "UTC",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T14:00:00.000Z",
      durationMinutes: 60,
      slotStepMinutes: 60,
      participantEmails: ["multi.part1@example.com", "multi.part2@example.com"],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.participants.length, 3);

  const slotStarts = response.body.slots.map((s) => s.startAt);
  // 09:00 blocked by org
  assert.equal(slotStarts.includes("2026-08-25T09:00:00.000Z"), false);
  // 10:00 blocked by part1
  assert.equal(slotStarts.includes("2026-08-25T10:00:00.000Z"), false);
  // 11:00 is free for ALL
  assert.ok(slotStarts.includes("2026-08-25T11:00:00.000Z"));
  // 12:00 blocked by part2
  assert.equal(slotStarts.includes("2026-08-25T12:00:00.000Z"), false);
  // 13:00 is free for ALL
  assert.ok(slotStarts.includes("2026-08-25T13:00:00.000Z"));

  await Event.deleteMany({ _id: { $in: [orgEv._id, p1Ev._id, p2Ev._id] } });
  await User.deleteMany({ _id: { $in: [organizer._id, part1._id, part2._id] } });
});

test("POST /api/scheduling/available-slots returns 400 when participant email is unknown", async () => {
  const organizer = await User.create({
    email: "org.unknown.test@example.com",
    name: "Org Unknown Test",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T12:00:00.000Z",
      durationMinutes: 60,
      participantEmails: ["nonexistent.participant@example.com"],
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.match(
    response.body.message,
    /User not found for participant email: nonexistent.participant@example.com/,
  );

  await User.deleteOne({ _id: organizer._id });
});

test("POST /api/scheduling/available-slots deduplicates participant emails and organizer email", async () => {
  const organizer = await User.create({
    email: "org.dedup@example.com",
    name: "Org Dedup",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const part = await User.create({
    email: "part.dedup@example.com",
    name: "Part Dedup",
    timezone: "UTC",
    passwordHash: "hash123",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-08-25T09:00:00.000Z",
      windowEnd: "2026-08-25T12:00:00.000Z",
      durationMinutes: 60,
      participantEmails: [
        "part.dedup@example.com",
        "PART.DEDUP@EXAMPLE.COM",
        "org.dedup@example.com",
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.participants.length, 2);
  assert.equal(response.body.participants[0].email, "org.dedup@example.com");
  assert.equal(response.body.participants[1].email, "part.dedup@example.com");

  await User.deleteMany({ _id: { $in: [organizer._id, part._id] } });
});

test("POST /api/scheduling/available-slots respects organizer timezone for scoring preferences", async () => {
  const organizer = await User.create({
    email: "org.tz.kolkata@example.com",
    name: "Org Kolkata",
    timezone: "Asia/Kolkata",
    passwordHash: "hash123",
  });

  const participant = await User.create({
    email: "part.tz.ny@example.com",
    name: "Part New York",
    timezone: "America/New_York",
    passwordHash: "hash123",
  });

  const token = createAuthToken({ id: organizer.id, email: organizer.email, name: organizer.name });

  // 05:00 UTC is 10:30 AM in Asia/Kolkata -> avoids early morning (< 10 AM)
  const response = await request(app)
    .post("/api/scheduling/available-slots")
    .set("Authorization", `Bearer ${token}`)
    .send({
      windowStart: "2026-09-26T05:00:00.000Z",
      windowEnd: "2026-09-26T07:00:00.000Z",
      durationMinutes: 60,
      participantEmails: ["part.tz.ny@example.com"],
      preferences: {
        avoidEarlyMorning: true,
      },
    });

  assert.equal(response.status, 200);
  const slots = response.body.slots;
  assert.ok(slots.length > 0);
  assert.ok(slots[0].reasons.includes("Avoids early morning"));
  assert.equal(slots[0].reasons.includes("Early morning penalty"), false);

  await User.deleteMany({ _id: { $in: [organizer._id, participant._id] } });
});



