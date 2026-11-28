// Publishes scheduling domain events after the database write has committed.
//
// Recipients are always derived from the canonical record, never from client
// input:
//   - personal events  -> the owner only
//   - shared meetings  -> the organizer plus every registered participant
//                         (the same users who can already read the meeting
//                         through GET /api/events)
//   - resource busy-time changes -> all authenticated users, resource id only
//
// Each publish does two things:
//   1. pushes the live Socket.io update (Phase L), and
//   2. queues a BullMQ job that turns the change into stored in-app
//      notifications (Phase M). Jobs carry ids only; the worker reloads the
//      meeting from MongoDB. Queueing never throws.
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { enqueueNotification } from "../queues/queueService.js";
import {
  REALTIME_EVENTS,
  emitResourceBookingChanged,
  emitToUsers,
} from "../realtime/realtimeService.js";

function idOf(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  if (value.id) return String(value.id);
  return value.toString();
}

export function getMeetingMemberIds(record) {
  const ids = [idOf(record.owner)];

  for (const participant of record.participants || []) {
    const participantId = idOf(participant.user);

    if (participantId) {
      ids.push(participantId);
    }
  }

  return Array.from(new Set(ids.filter(Boolean)));
}

function isSharedMeeting(record) {
  return (record.participants || []).some((participant) => Boolean(participant.user));
}

function resourceIdOf(record) {
  return idOf(record?.resource);
}

function toIso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function getMeetingChanges(event, { previousResourceId, previousStartAt, previousEndAt, previousLocation } = {}) {
  const changes = [];

  if (
    (previousStartAt && toIso(previousStartAt) !== toIso(event.startAt)) ||
    (previousEndAt && toIso(previousEndAt) !== toIso(event.endAt))
  ) {
    changes.push("time");
  }

  if (previousLocation !== undefined && (previousLocation || "") !== (event.location || "")) {
    changes.push("location");
  }

  if (previousResourceId !== undefined && (idOf(previousResourceId) || null) !== (resourceIdOf(event) || null)) {
    changes.push("resource");
  }

  return changes;
}

export function publishEventCreated(event) {
  emitToUsers([idOf(event.owner)], REALTIME_EVENTS.EVENT_CREATED, { event });
  emitResourceBookingChanged([resourceIdOf(event)]);
}

export function publishEventUpdated(event, previous = {}) {
  const { previousResourceId = null, previousStartAt = null, previousEndAt = null } = previous;

  if (isSharedMeeting(event)) {
    emitToUsers(getMeetingMemberIds(event), REALTIME_EVENTS.MEETING_UPDATED, {
      meeting: event,
    });

    // Only changes that matter to attendees produce a notification; a typo
    // fix in the description does not.
    const changes = getMeetingChanges(event, previous);

    if (changes.length > 0) {
      enqueueNotification(NOTIFICATION_TYPES.MEETING_UPDATED, {
        eventId: idOf(event.id || event._id),
        changes,
      });
    }
  } else {
    emitToUsers([idOf(event.owner)], REALTIME_EVENTS.EVENT_UPDATED, { event });
  }

  const resourceChanged = idOf(previousResourceId) !== resourceIdOf(event);
  const timeChanged =
    (previousStartAt && new Date(previousStartAt).toISOString() !== event.startAt) ||
    (previousEndAt && new Date(previousEndAt).toISOString() !== event.endAt);

  if (resourceChanged || timeChanged) {
    emitResourceBookingChanged([idOf(previousResourceId), resourceIdOf(event)]);
  }
}

export function publishEventDeleted(record) {
  emitToUsers(getMeetingMemberIds(record), REALTIME_EVENTS.EVENT_DELETED, {
    eventId: idOf(record._id || record.id),
  });
  emitResourceBookingChanged([resourceIdOf(record)]);

  // The meeting no longer exists when the job runs, so the job carries the
  // minimum needed to tell its participants: title, time and their user ids.
  if (isSharedMeeting(record) && record.status !== "cancelled") {
    enqueueNotification(NOTIFICATION_TYPES.MEETING_CANCELLED, {
      deleted: true,
      snapshot: {
        ownerId: idOf(record.owner),
        title: record.title,
        startAt: toIso(record.startAt),
        endAt: toIso(record.endAt),
        participantIds: (record.participants || []).map((p) => idOf(p.user)).filter(Boolean),
      },
    });
  }
}

export function publishMeetingConfirmed(meeting) {
  const organizerId = idOf(meeting.owner);

  emitToUsers([organizerId], REALTIME_EVENTS.MEETING_CONFIRMED, { meeting });

  const inviteeIds = getMeetingMemberIds(meeting).filter((id) => id !== organizerId);
  emitToUsers(inviteeIds, REALTIME_EVENTS.INVITATION_CREATED, { meeting });

  emitResourceBookingChanged([resourceIdOf(meeting)]);

  enqueueNotification(NOTIFICATION_TYPES.INVITATION_CREATED, {
    eventId: idOf(meeting.id || meeting._id),
  });
}

export function publishInvitationResponded(meeting, { responderId, status }) {
  const eventName =
    status === "accepted"
      ? REALTIME_EVENTS.INVITATION_ACCEPTED
      : REALTIME_EVENTS.INVITATION_DECLINED;

  emitToUsers(getMeetingMemberIds(meeting), eventName, {
    meeting,
    responderId: idOf(responderId),
    status,
  });

  enqueueNotification(NOTIFICATION_TYPES.INVITATION_RESPONDED, {
    eventId: idOf(meeting.id || meeting._id),
    responderId: idOf(responderId),
    status,
  });
}

export function publishMeetingCancelled(meeting) {
  emitToUsers(getMeetingMemberIds(meeting), REALTIME_EVENTS.MEETING_CANCELLED, {
    meeting,
  });
  emitResourceBookingChanged([resourceIdOf(meeting)]);

  enqueueNotification(NOTIFICATION_TYPES.MEETING_CANCELLED, {
    eventId: idOf(meeting.id || meeting._id),
  });
}
