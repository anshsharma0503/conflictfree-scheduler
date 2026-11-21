// Publishes scheduling domain events after the database write has committed.
//
// Recipients are always derived from the canonical record, never from client
// input:
//   - personal events  -> the owner only
//   - shared meetings  -> the organizer plus every registered participant
//                         (the same users who can already read the meeting
//                         through GET /api/events)
//   - resource busy-time changes -> all authenticated users, resource id only
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

export function publishEventCreated(event) {
  emitToUsers([idOf(event.owner)], REALTIME_EVENTS.EVENT_CREATED, { event });
  emitResourceBookingChanged([resourceIdOf(event)]);
}

export function publishEventUpdated(event, { previousResourceId = null, previousStartAt = null, previousEndAt = null } = {}) {
  if (isSharedMeeting(event)) {
    emitToUsers(getMeetingMemberIds(event), REALTIME_EVENTS.MEETING_UPDATED, {
      meeting: event,
    });
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
}

export function publishMeetingConfirmed(meeting) {
  const organizerId = idOf(meeting.owner);

  emitToUsers([organizerId], REALTIME_EVENTS.MEETING_CONFIRMED, { meeting });

  const inviteeIds = getMeetingMemberIds(meeting).filter((id) => id !== organizerId);
  emitToUsers(inviteeIds, REALTIME_EVENTS.INVITATION_CREATED, { meeting });

  emitResourceBookingChanged([resourceIdOf(meeting)]);
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
}

export function publishMeetingCancelled(meeting) {
  emitToUsers(getMeetingMemberIds(meeting), REALTIME_EVENTS.MEETING_CANCELLED, {
    meeting,
  });
  emitResourceBookingChanged([resourceIdOf(meeting)]);
}
