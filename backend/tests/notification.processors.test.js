import "dotenv/config";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Event from "../src/models/Event.js";
import Notification, { NOTIFICATION_TYPES } from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { processNotificationJob, runReminderSweep } from "../src/queues/processors.js";
import { setRealtimeServer } from "../src/realtime/realtimeService.js";

const emails = ["np-org@example.com", "np-alpha@example.com", "np-beta@example.com"];
const MINUTE = 60_000;

let organizer;
let alpha;
let beta;
let pushes;

function fakeIo() {
  return {
    to(rooms) {
      return {
        emit(eventName, payload) {
          pushes.push({ rooms, eventName, payload });
        },
      };
    },
  };
}

async function createUser(name, email, extra = {}) {
  return User.create({
    name,
    email,
    timezone: "UTC",
    authProvider: "local",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
    ...extra,
  });
}

async function createMeeting({ startAt, participants, status = "active", title = "Roadmap review" }) {
  return Event.create({
    owner: organizer._id,
    title,
    startAt,
    endAt: new Date(startAt.getTime() + 60 * MINUTE),
    timezone: "UTC",
    participants,
    status,
  });
}

function job(name, data, id = `job-${Math.random().toString(36).slice(2)}`) {
  return { id, name, data };
}

before(async () => {
  await connectDatabase();
  await Notification.init();
});

beforeEach(async () => {
  pushes = [];
  setRealtimeServer(fakeIo());
  await Event.deleteMany({});
  await Notification.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });

  organizer = await createUser("Raj Organizer", emails[0]);
  alpha = await createUser("Alpha Invitee", emails[1]);
  beta = await createUser("Beta Invitee", emails[2], { reminderMinutesBefore: 60 });
});

after(async () => {
  setRealtimeServer(null);
  await Event.deleteMany({});
  await Notification.deleteMany({});
  await User.deleteMany({ email: { $in: emails } });
  await disconnectDatabase();
});

test("invitation job notifies invitees and pushes each one with an unread count", async () => {
  const meeting = await createMeeting({
    startAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
    participants: [
      { user: alpha._id, email: alpha.email, status: "pending" },
      { user: beta._id, email: beta.email, status: "pending" },
    ],
  });

  const result = await processNotificationJob(
    job(NOTIFICATION_TYPES.INVITATION_CREATED, { eventId: meeting.id }),
  );

  assert.equal(result.created, 2);
  const stored = await Notification.find({}).lean();
  assert.deepEqual(
    stored.map((n) => n.user.toString()).sort(),
    [alpha.id, beta.id].sort(),
  );
  assert.equal(stored[0].message, "Raj Organizer invited you to “Roadmap review”");

  const notificationPushes = pushes.filter((p) => p.eventName === "notification:created");
  assert.equal(notificationPushes.length, 2);
  assert.deepEqual(
    notificationPushes.map((p) => p.rooms).sort(),
    [[`user:${alpha.id}`], [`user:${beta.id}`]].sort(),
  );
  assert.equal(notificationPushes[0].payload.unreadCount, 1);
  assert.equal(notificationPushes[0].payload.notification.read, false);
  assert.equal(notificationPushes[0].payload.notification.eventId, meeting.id);
});

test("a retried job (same job id) never creates duplicates or pushes twice", async () => {
  const meeting = await createMeeting({
    startAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
    participants: [{ user: alpha._id, email: alpha.email, status: "pending" }],
  });
  const retried = job(NOTIFICATION_TYPES.INVITATION_CREATED, { eventId: meeting.id }, "fixed-id");

  await processNotificationJob(retried);
  const second = await processNotificationJob(retried);

  assert.equal(second.created, 0);
  assert.equal(await Notification.countDocuments({}), 1);
  assert.equal(pushes.filter((p) => p.eventName === "notification:created").length, 1);
});

test("an RSVP notifies the organizer with the responder's name", async () => {
  const meeting = await createMeeting({
    startAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
    participants: [{ user: alpha._id, email: alpha.email, status: "declined" }],
  });

  await processNotificationJob(
    job(NOTIFICATION_TYPES.INVITATION_RESPONDED, {
      eventId: meeting.id,
      responderId: alpha.id,
      status: "declined",
    }),
  );

  const [notification] = await Notification.find({}).lean();
  assert.equal(notification.user.toString(), organizer.id);
  assert.equal(notification.message, "Alpha Invitee declined “Roadmap review”");
  assert.equal(notification.data.status, "declined");
});

test("a reschedule skips declined invitees; a cancelled meeting gets no update notice", async () => {
  const meeting = await createMeeting({
    startAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
    participants: [
      { user: alpha._id, email: alpha.email, status: "accepted" },
      { user: beta._id, email: beta.email, status: "declined" },
    ],
  });

  await processNotificationJob(
    job(NOTIFICATION_TYPES.MEETING_UPDATED, { eventId: meeting.id, changes: ["time"] }),
  );
  const updates = await Notification.find({}).lean();
  assert.deepEqual(
    updates.map((n) => n.user.toString()),
    [alpha.id],
  );
  assert.equal(updates[0].message, "Raj Organizer rescheduled “Roadmap review”");

  meeting.status = "cancelled";
  await meeting.save();
  const skipped = await processNotificationJob(
    job(NOTIFICATION_TYPES.MEETING_UPDATED, { eventId: meeting.id, changes: ["time"] }),
  );
  assert.equal(skipped.skipped, "meeting_cancelled");
});

test("a cancellation and a deletion both notify the invitees", async () => {
  const meeting = await createMeeting({
    startAt: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
    participants: [{ user: alpha._id, email: alpha.email, status: "accepted" }],
    status: "cancelled",
  });

  await processNotificationJob(job(NOTIFICATION_TYPES.MEETING_CANCELLED, { eventId: meeting.id }));
  await processNotificationJob(
    job(NOTIFICATION_TYPES.MEETING_CANCELLED, {
      deleted: true,
      snapshot: {
        ownerId: organizer.id,
        title: "Old sync",
        startAt: meeting.startAt.toISOString(),
        endAt: meeting.endAt.toISOString(),
        participantIds: [alpha.id],
      },
    }),
  );

  const messages = (await Notification.find({ user: alpha._id }).lean()).map((n) => n.message).sort();
  assert.deepEqual(messages, ["Raj Organizer cancelled “Roadmap review”", "Raj Organizer removed “Old sync”"]);
});

test("a job for a meeting that no longer exists completes without notifying", async () => {
  const result = await processNotificationJob(
    job(NOTIFICATION_TYPES.INVITATION_CREATED, { eventId: "64b7f0f0f0f0f0f0f0f0f0f0" }),
  );

  assert.deepEqual(result, { created: 0, skipped: "event_not_found" });
});

test("reminder sweep honours each user's lead time and invitation status", async () => {
  const now = new Date();
  // Starts in 30 minutes: inside beta's 60-minute lead, outside the default 15.
  await createMeeting({
    startAt: new Date(now.getTime() + 30 * MINUTE),
    participants: [
      { user: alpha._id, email: alpha.email, status: "pending" },
      { user: beta._id, email: beta.email, status: "accepted" },
    ],
  });

  const first = await runReminderSweep({ now });
  assert.equal(first.created, 1);

  const [reminder] = await Notification.find({}).lean();
  assert.equal(reminder.user.toString(), beta.id);
  assert.equal(reminder.type, NOTIFICATION_TYPES.EVENT_REMINDER);
  assert.equal(reminder.message, "“Roadmap review” starts in 30 minutes");

  // 20 minutes later the organizer's default 15-minute lead is reached.
  const later = await runReminderSweep({ now: new Date(now.getTime() + 20 * MINUTE) });
  assert.equal(later.created, 1);
  assert.equal(await Notification.countDocuments({ user: organizer._id }), 1);

  // Pending invitees are never reminded, and repeated sweeps add nothing.
  assert.equal(await Notification.countDocuments({ user: alpha._id }), 0);
  const repeat = await runReminderSweep({ now: new Date(now.getTime() + 21 * MINUTE) });
  assert.equal(repeat.created, 0);
});

test("reminder sweep skips cancelled and started events, and users who turned reminders off", async () => {
  const now = new Date();
  await User.updateOne({ _id: organizer._id }, { $set: { reminderMinutesBefore: 0 } });

  await createMeeting({ startAt: new Date(now.getTime() + 5 * MINUTE), participants: [] });
  await createMeeting({
    startAt: new Date(now.getTime() + 5 * MINUTE),
    participants: [{ user: beta._id, email: beta.email, status: "accepted" }],
    status: "cancelled",
  });
  await createMeeting({
    startAt: new Date(now.getTime() - 5 * MINUTE),
    participants: [{ user: beta._id, email: beta.email, status: "accepted" }],
  });

  const result = await runReminderSweep({ now });

  assert.equal(result.created, 0);
  assert.equal(await Notification.countDocuments({}), 0);
});

test("rescheduling an event after its reminder produces a new reminder", async () => {
  const now = new Date();
  const meeting = await createMeeting({ startAt: new Date(now.getTime() + 10 * MINUTE), participants: [] });

  await runReminderSweep({ now });
  meeting.startAt = new Date(now.getTime() + 12 * MINUTE);
  meeting.endAt = new Date(now.getTime() + 72 * MINUTE);
  await meeting.save();
  await runReminderSweep({ now });

  assert.equal(await Notification.countDocuments({ user: organizer._id }), 2);
});
