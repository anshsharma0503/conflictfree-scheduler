import Event from "../../models/Event.js";
import { buildBlockingEventQuery } from "./calendarQueryService.js";

export function normalizeTimeRange({ startAt, endAt }) {
  if (!startAt) {
    throw new Error("startAt is required");
  }

  if (!endAt) {
    throw new Error("endAt is required");
  }

  const start = new Date(startAt);
  const end = new Date(endAt);

  if (isNaN(start.getTime())) {
    throw new Error("startAt must be a valid date");
  }

  if (isNaN(end.getTime())) {
    throw new Error("endAt must be a valid date");
  }

  if (end <= start) {
    throw new Error("endAt must be after startAt");
  }

  return { start, end };
}


export function eventsOverlap(rangeA, rangeB) {
  return rangeA.start < rangeB.end && rangeA.end > rangeB.start;
}

export async function findConflictingEvents({
  ownerId,
  startAt,
  endAt,
  excludeEventId,
  EventModel = Event,
}) {
  const { start, end } = normalizeTimeRange({ startAt, endAt });

  // Owned events plus shared meetings where the user holds a pending or
  // accepted invitation. Declined invitations and cancelled meetings never
  // conflict.
  const query = buildBlockingEventQuery({
    userIds: [ownerId],
    startAt: start,
    endAt: end,
    excludeEventId,
  });

  const conflicts = await EventModel.find(query).sort({ startAt: 1 });

  return conflicts;
}