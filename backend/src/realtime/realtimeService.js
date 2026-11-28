import { logger } from "../services/logger.js";

/**
 * Socket.io event names. Every payload is privacy-scoped to its recipients
 * (see docs/ARCHITECTURE.md "Real-time updates").
 */
export const REALTIME_EVENTS = Object.freeze({
  EVENT_CREATED: "event:created",
  EVENT_UPDATED: "event:updated",
  EVENT_DELETED: "event:deleted",
  MEETING_CONFIRMED: "meeting:confirmed",
  MEETING_UPDATED: "meeting:updated",
  MEETING_CANCELLED: "meeting:cancelled",
  INVITATION_CREATED: "invitation:created",
  INVITATION_ACCEPTED: "invitation:accepted",
  INVITATION_DECLINED: "invitation:declined",
  RESOURCE_CREATED: "resource:created",
  RESOURCE_UPDATED: "resource:updated",
  RESOURCE_DEACTIVATED: "resource:deactivated",
  RESOURCE_BOOKING_CHANGED: "resource:booking-changed",
  NOTIFICATION_CREATED: "notification:created",
  NOTIFICATION_READ: "notification:read",
});

/** Room every authenticated socket joins; used only for non-private data. */
export const AUTHENTICATED_ROOM = "authenticated";

export function userRoom(userId) {
  return `user:${userId}`;
}

let ioInstance = null;

export function setRealtimeServer(io) {
  ioInstance = io;
}

export function getRealtimeServer() {
  return ioInstance;
}

function uniqueIds(userIds = []) {
  return Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .filter(Boolean)
        .map((id) => (id?._id ? id._id.toString() : id.toString())),
    ),
  );
}

function withEnvelope(payload) {
  return { ...payload, occurredAt: new Date().toISOString() };
}

/**
 * Emit to the private rooms of specific users. Callers must only pass users
 * who are authorized to see the payload. Emission failures never break the
 * HTTP request that triggered them.
 */
export function emitToUsers(userIds, eventName, payload = {}) {
  if (!ioInstance) {
    return;
  }

  const rooms = uniqueIds(userIds).map(userRoom);

  if (rooms.length === 0) {
    return;
  }

  try {
    ioInstance.to(rooms).emit(eventName, withEnvelope(payload));
  } catch (error) {
    logger.warn("realtime_emit_failed", { eventName, errorMessage: error.message });
  }
}

/**
 * Emit non-private data (e.g. a resource catalogue change) to every
 * authenticated socket.
 */
export function emitToAuthenticated(eventName, payload = {}) {
  if (!ioInstance) {
    return;
  }

  try {
    ioInstance.to(AUTHENTICATED_ROOM).emit(eventName, withEnvelope(payload));
  } catch (error) {
    logger.warn("realtime_emit_failed", { eventName, errorMessage: error.message });
  }
}

/**
 * A resource's busy time changed. Only the resource id is broadcast: never
 * the booking's title, owner, attendees, or even its time range, so clients
 * simply re-query availability through the normal authorized API.
 */
export function emitResourceBookingChanged(resourceIds = []) {
  for (const resourceId of uniqueIds(resourceIds)) {
    emitToAuthenticated(REALTIME_EVENTS.RESOURCE_BOOKING_CHANGED, { resourceId });
  }
}
