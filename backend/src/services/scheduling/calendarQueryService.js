import mongoose from "mongoose";

/**
 * Invitation statuses that reserve a participant's time. Declined invitations
 * never block availability.
 */
export const BLOCKING_INVITATION_STATUSES = Object.freeze(["pending", "accepted"]);

function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) {
    return id;
  }

  const raw = id?._id ? id._id : id;
  const asString = raw?.toString?.();

  return mongoose.Types.ObjectId.isValid(asString)
    ? new mongoose.Types.ObjectId(asString)
    : raw;
}

/**
 * Builds the canonical "this event occupies these users' calendars" filter:
 * events they own plus shared meetings where they hold a pending or accepted
 * invitation. Cancelled meetings are excluded by `buildBlockingEventQuery`.
 *
 * Participant matching uses the verified `participants.user` reference only,
 * never a free-text email, so nobody can place events on another user's
 * calendar by typing their address.
 */
export function buildCalendarOccupancyMatcher(userIds = []) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .map(toObjectId);

  const userMatcher = ids.length === 1 ? ids[0] : { $in: ids };

  return [
    { owner: userMatcher },
    {
      participants: {
        $elemMatch: {
          user: userMatcher,
          status: { $in: BLOCKING_INVITATION_STATUSES },
        },
      },
    },
  ];
}

/**
 * Query for non-cancelled events that overlap [startAt, endAt) in absolute
 * time and occupy any of the given users' calendars. Uses the open-interval
 * overlap rule `existing.startAt < endAt && existing.endAt > startAt`, so
 * back-to-back events never conflict.
 */
export function buildBlockingEventQuery({
  userIds,
  startAt,
  endAt,
  excludeEventId = null,
}) {
  const query = {
    status: { $ne: "cancelled" },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
    $or: buildCalendarOccupancyMatcher(userIds),
  };

  if (excludeEventId) {
    query._id = { $ne: toObjectId(excludeEventId) };
  }

  return query;
}

/**
 * Visibility filter: events a user may read (owned, or a meeting they are a
 * registered participant of).
 */
export function buildEventVisibilityMatcher(userId) {
  const id = toObjectId(userId);

  return [{ owner: id }, { "participants.user": id }];
}

/**
 * IDs of users whose calendars a shared meeting occupies: the organizer plus
 * participants whose invitation still reserves their time.
 */
export function getMeetingOccupantIds(meeting) {
  const ids = [meeting.owner?._id || meeting.owner];

  for (const participant of meeting.participants || []) {
    if (
      participant.user &&
      BLOCKING_INVITATION_STATUSES.includes(participant.status || "pending")
    ) {
      ids.push(participant.user?._id || participant.user);
    }
  }

  return ids.filter(Boolean);
}
