// Pure rules: who is notified about what, and with which wording.
// No database or Redis access, so every rule is unit-testable.
import { NOTIFICATION_TYPES } from "../../models/Notification.js";

const MS_PER_MINUTE = 60_000;

function idOf(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
}

function quoted(title) {
  return `“${title || "Untitled"}”`;
}

function displayName(person, fallback = "Someone") {
  return person?.name || person?.email || fallback;
}

function eventData(meeting, extra = {}) {
  return {
    eventTitle: meeting.title || "",
    startAt: meeting.startAt || null,
    endAt: meeting.endAt || null,
    ...extra,
  };
}

/**
 * Registered participants of a meeting, excluding the organizer.
 * `excludeDeclined` drops people who already said no.
 */
export function getParticipantRecipientIds(meeting, { excludeDeclined = false } = {}) {
  const ownerId = idOf(meeting.owner);
  const ids = [];

  for (const participant of meeting.participants || []) {
    const userId = idOf(participant.user);

    if (!userId || userId === ownerId) continue;
    if (excludeDeclined && participant.status === "declined") continue;

    ids.push(userId);
  }

  return Array.from(new Set(ids));
}

/**
 * Builds the notification records for one domain event.
 *
 * @param {object} input
 * @param {string} input.type        one of NOTIFICATION_TYPES (not reminders)
 * @param {object} input.meeting     current meeting (or a snapshot if it was deleted)
 * @param {object} input.organizer   { name, email } of the organizer
 * @param {string} input.dedupeId    stable id of the job (same on retries)
 * @param {object} [input.responder] { id, name, email } for invitation responses
 * @param {string} [input.status]    "accepted" | "declined" for responses
 * @param {string[]} [input.changes] for updates: "time" | "location" | "resource"
 * @param {boolean} [input.deleted]  the meeting was deleted rather than cancelled
 */
export function buildMeetingNotifications({
  type,
  meeting,
  organizer,
  dedupeId,
  responder = null,
  status = "",
  changes = [],
  deleted = false,
}) {
  if (!meeting || !dedupeId) {
    return [];
  }

  const eventId = deleted ? null : idOf(meeting._id || meeting.id);
  const organizerName = displayName(organizer, "The organizer");
  const dedupeKey = `${type}:${dedupeId}`;
  const make = (userId, message, extra = {}) => ({
    user: userId,
    type,
    message,
    event: eventId,
    data: eventData(meeting, extra),
    dedupeKey,
  });

  switch (type) {
    case NOTIFICATION_TYPES.INVITATION_CREATED:
      return getParticipantRecipientIds(meeting).map((userId) =>
        make(userId, `${organizerName} invited you to ${quoted(meeting.title)}`, {
          actorName: organizerName,
        }),
      );

    case NOTIFICATION_TYPES.INVITATION_RESPONDED: {
      const ownerId = idOf(meeting.owner);
      const responderId = idOf(responder?.id);

      if (!ownerId || !responderId || responderId === ownerId) return [];
      if (status !== "accepted" && status !== "declined") return [];

      const responderName = displayName(responder);
      return [
        make(ownerId, `${responderName} ${status} ${quoted(meeting.title)}`, {
          actorName: responderName,
          status,
        }),
      ];
    }

    case NOTIFICATION_TYPES.MEETING_UPDATED: {
      const verb = changes.includes("time") ? "rescheduled" : "updated";
      return getParticipantRecipientIds(meeting, { excludeDeclined: true }).map((userId) =>
        make(userId, `${organizerName} ${verb} ${quoted(meeting.title)}`, {
          actorName: organizerName,
        }),
      );
    }

    case NOTIFICATION_TYPES.MEETING_CANCELLED: {
      const verb = deleted ? "removed" : "cancelled";
      return getParticipantRecipientIds(meeting).map((userId) =>
        make(userId, `${organizerName} ${verb} ${quoted(meeting.title)}`, {
          actorName: organizerName,
          status: "cancelled",
        }),
      );
    }

    default:
      return [];
  }
}

/** "15 minutes", "1 hour", "2 hours", "1 day". */
export function formatLeadTime(minutes) {
  const value = Math.max(1, Math.round(minutes));

  if (value < 60) {
    return `${value} minute${value === 1 ? "" : "s"}`;
  }

  if (value < 1440) {
    const hours = Math.round(value / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.round(value / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Users who should get a reminder for an event: the organizer and every
 * participant who accepted. Pending and declined invitees are not reminded.
 */
export function getReminderRecipientIds(event) {
  const ids = [idOf(event.owner)];

  for (const participant of event.participants || []) {
    const userId = idOf(participant.user);

    if (userId && participant.status === "accepted") {
      ids.push(userId);
    }
  }

  return Array.from(new Set(ids.filter(Boolean)));
}

/**
 * Picks the reminders that are due at `now`.
 *
 * A reminder is due once `now >= startAt - lead` and the event has not
 * started. The dedupe key includes the start time, so moving an event
 * produces a fresh reminder while repeated sweeps never duplicate one.
 *
 * @param {object[]} events           active events starting after `now`
 * @param {Map<string, number>} leadByUserId  reminder lead (minutes) per user; 0 = off
 * @param {Date} now
 */
export function selectDueReminders({ events = [], leadByUserId = new Map(), now = new Date() }) {
  const nowMs = now.getTime();
  const reminders = [];

  for (const event of events) {
    if (event.status === "cancelled") continue;

    const startMs = new Date(event.startAt).getTime();
    if (!Number.isFinite(startMs) || startMs <= nowMs) continue;

    const minutesUntilStart = (startMs - nowMs) / MS_PER_MINUTE;
    const startIso = new Date(startMs).toISOString();
    const eventId = idOf(event._id || event.id);

    for (const userId of getReminderRecipientIds(event)) {
      const lead = leadByUserId.get(userId) ?? 0;

      if (lead > 0 && minutesUntilStart <= lead) {
        reminders.push({
          user: userId,
          type: NOTIFICATION_TYPES.EVENT_REMINDER,
          message: `${quoted(event.title)} starts in ${formatLeadTime(Math.ceil(minutesUntilStart))}`,
          event: eventId,
          data: eventData(event),
          dedupeKey: `${NOTIFICATION_TYPES.EVENT_REMINDER}:${eventId}:${startIso}`,
        });
      }
    }
  }

  return reminders;
}
