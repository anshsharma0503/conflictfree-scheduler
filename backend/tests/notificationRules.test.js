import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_TYPES } from "../src/models/Notification.js";
import {
  buildMeetingNotifications,
  formatLeadTime,
  getParticipantRecipientIds,
  getReminderRecipientIds,
  selectDueReminders,
} from "../src/services/notifications/notificationRules.js";

const meeting = {
  _id: "meeting-1",
  owner: "owner-1",
  title: "Roadmap review",
  startAt: new Date("2026-12-01T10:00:00.000Z"),
  endAt: new Date("2026-12-01T11:00:00.000Z"),
  participants: [
    { user: "alpha", status: "pending" },
    { user: "beta", status: "accepted" },
    { user: "gamma", status: "declined" },
    { user: null, email: "guest@example.com", status: "pending" },
    { user: "owner-1", status: "accepted" },
  ],
};
const organizer = { name: "Raj", email: "raj@example.com" };

test("participant recipients are registered users other than the organizer", () => {
  assert.deepEqual(getParticipantRecipientIds(meeting), ["alpha", "beta", "gamma"]);
  assert.deepEqual(getParticipantRecipientIds(meeting, { excludeDeclined: true }), [
    "alpha",
    "beta",
  ]);
});

test("an invitation notifies every invitee, never the organizer", () => {
  const records = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.INVITATION_CREATED,
    meeting,
    organizer,
    dedupeId: "job-1",
  });

  assert.deepEqual(
    records.map((r) => r.user),
    ["alpha", "beta", "gamma"],
  );
  assert.equal(records[0].message, "Raj invited you to “Roadmap review”");
  assert.equal(records[0].event, "meeting-1");
  assert.equal(records[0].dedupeKey, "invitation.created:job-1");
  assert.equal(records[0].data.eventTitle, "Roadmap review");
  assert.equal(records[0].data.actorName, "Raj");
});

test("a response notifies only the organizer, and only for accepted/declined", () => {
  const accepted = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.INVITATION_RESPONDED,
    meeting,
    organizer,
    dedupeId: "job-2",
    responder: { id: "beta", name: "Beta" },
    status: "accepted",
  });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].user, "owner-1");
  assert.equal(accepted[0].message, "Beta accepted “Roadmap review”");
  assert.equal(accepted[0].data.status, "accepted");

  const invalid = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.INVITATION_RESPONDED,
    meeting,
    organizer,
    dedupeId: "job-3",
    responder: { id: "beta" },
    status: "maybe",
  });
  assert.deepEqual(invalid, []);

  const selfResponse = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.INVITATION_RESPONDED,
    meeting,
    organizer,
    dedupeId: "job-4",
    responder: { id: "owner-1" },
    status: "accepted",
  });
  assert.deepEqual(selfResponse, []);
});

test("an update skips people who declined and says 'rescheduled' when the time moved", () => {
  const moved = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.MEETING_UPDATED,
    meeting,
    organizer,
    dedupeId: "job-5",
    changes: ["time"],
  });

  assert.deepEqual(
    moved.map((r) => r.user),
    ["alpha", "beta"],
  );
  assert.equal(moved[0].message, "Raj rescheduled “Roadmap review”");

  const relocated = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.MEETING_UPDATED,
    meeting,
    organizer,
    dedupeId: "job-6",
    changes: ["location"],
  });
  assert.equal(relocated[0].message, "Raj updated “Roadmap review”");
});

test("a cancellation notifies all invitees; a deletion has no event link", () => {
  const cancelled = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.MEETING_CANCELLED,
    meeting,
    organizer,
    dedupeId: "job-7",
  });
  assert.equal(cancelled.length, 3);
  assert.equal(cancelled[0].message, "Raj cancelled “Roadmap review”");
  assert.equal(cancelled[0].event, "meeting-1");

  const deleted = buildMeetingNotifications({
    type: NOTIFICATION_TYPES.MEETING_CANCELLED,
    meeting,
    organizer,
    dedupeId: "job-8",
    deleted: true,
  });
  assert.equal(deleted[0].message, "Raj removed “Roadmap review”");
  assert.equal(deleted[0].event, null);
});

test("no records without a meeting or a dedupe id", () => {
  assert.deepEqual(
    buildMeetingNotifications({ type: NOTIFICATION_TYPES.INVITATION_CREATED, meeting, dedupeId: "" }),
    [],
  );
  assert.deepEqual(
    buildMeetingNotifications({ type: NOTIFICATION_TYPES.INVITATION_CREATED, meeting: null, dedupeId: "x" }),
    [],
  );
});

test("lead times read naturally", () => {
  assert.equal(formatLeadTime(1), "1 minute");
  assert.equal(formatLeadTime(15), "15 minutes");
  assert.equal(formatLeadTime(60), "1 hour");
  assert.equal(formatLeadTime(150), "3 hours");
  assert.equal(formatLeadTime(1440), "1 day");
  assert.equal(formatLeadTime(0), "1 minute");
});

test("reminders go to the organizer and accepted participants only", () => {
  assert.deepEqual(getReminderRecipientIds(meeting), ["owner-1", "beta"]);
});

test("a reminder is due inside its lead window and before the event starts", () => {
  const now = new Date("2026-12-01T09:50:00.000Z"); // 10 minutes before
  const leads = new Map([
    ["owner-1", 15],
    ["beta", 5],
  ]);

  const due = selectDueReminders({ events: [meeting], leadByUserId: leads, now });

  assert.deepEqual(
    due.map((r) => r.user),
    ["owner-1"],
  );
  assert.equal(due[0].type, NOTIFICATION_TYPES.EVENT_REMINDER);
  assert.equal(due[0].message, "“Roadmap review” starts in 10 minutes");
  assert.equal(due[0].dedupeKey, "event.reminder:meeting-1:2026-12-01T10:00:00.000Z");
});

test("no reminder when turned off, after the start, or for cancelled events", () => {
  const leads = new Map([
    ["owner-1", 0],
    ["beta", 30],
  ]);
  const before = new Date("2026-12-01T09:50:00.000Z");

  assert.deepEqual(
    selectDueReminders({ events: [meeting], leadByUserId: leads, now: before }).map((r) => r.user),
    ["beta"],
  );

  const afterStart = new Date("2026-12-01T10:00:00.000Z");
  assert.deepEqual(selectDueReminders({ events: [meeting], leadByUserId: leads, now: afterStart }), []);

  assert.deepEqual(
    selectDueReminders({
      events: [{ ...meeting, status: "cancelled" }],
      leadByUserId: leads,
      now: before,
    }),
    [],
  );
});

test("moving an event changes the reminder's dedupe key", () => {
  const leads = new Map([["owner-1", 60]]);
  const now = new Date("2026-12-01T09:30:00.000Z");
  const first = selectDueReminders({ events: [meeting], leadByUserId: leads, now });
  const moved = selectDueReminders({
    events: [{ ...meeting, startAt: new Date("2026-12-01T10:15:00.000Z") }],
    leadByUserId: leads,
    now,
  });

  assert.notEqual(first[0].dedupeKey, moved[0].dedupeKey);
});
