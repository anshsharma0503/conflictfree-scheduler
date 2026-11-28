import mongoose from "mongoose";
import Notification from "../../models/Notification.js";
import { REALTIME_EVENTS, emitToUsers } from "../../realtime/realtimeService.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeNotification(notification) {
  return {
    id: notification._id.toString(),
    type: notification.type,
    message: notification.message,
    eventId: notification.event ? notification.event.toString() : null,
    data: {
      eventTitle: notification.data?.eventTitle || "",
      startAt: toIso(notification.data?.startAt),
      endAt: toIso(notification.data?.endAt),
      actorName: notification.data?.actorName || "",
      status: notification.data?.status || "",
    },
    read: Boolean(notification.readAt),
    readAt: toIso(notification.readAt),
    createdAt: toIso(notification.createdAt),
  };
}

export async function countUnread(userId, { NotificationModel = Notification } = {}) {
  return NotificationModel.countDocuments({ user: userId, readAt: null });
}

/**
 * Inserts notification records idempotently. A record whose (user, dedupeKey)
 * already exists is left untouched, so retried jobs and repeated reminder
 * sweeps never create duplicates. Returns only the newly created documents.
 */
export async function createNotifications(records = [], { NotificationModel = Notification } = {}) {
  if (records.length === 0) {
    return [];
  }

  const now = new Date();
  const result = await NotificationModel.bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { user: record.user, dedupeKey: record.dedupeKey },
        update: {
          $setOnInsert: {
            user: record.user,
            type: record.type,
            message: record.message,
            event: record.event || null,
            data: record.data || {},
            dedupeKey: record.dedupeKey,
            readAt: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
        // Timestamps are set in $setOnInsert above, so an existing
        // notification is not written to at all on a repeat.
        timestamps: false,
      },
    })),
    { ordered: false },
  );

  const upsertedIds = Object.values(result.upsertedIds || {});

  if (upsertedIds.length === 0) {
    return [];
  }

  return NotificationModel.find({ _id: { $in: upsertedIds } }).sort({ createdAt: 1 });
}

/**
 * Creates the notifications and pushes each new one to its recipient's
 * private Socket.io room, together with their new unread count.
 */
export async function deliverNotifications(records = [], { NotificationModel = Notification } = {}) {
  const created = await createNotifications(records, { NotificationModel });
  const byUser = new Map();

  for (const notification of created) {
    const userId = notification.user.toString();
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(notification);
  }

  for (const [userId, notifications] of byUser) {
    const unreadCount = await countUnread(userId, { NotificationModel });

    for (const notification of notifications) {
      emitToUsers([userId], REALTIME_EVENTS.NOTIFICATION_CREATED, {
        notification: serializeNotification(notification),
        unreadCount,
      });
    }
  }

  return created;
}

export async function listNotifications({
  userId,
  limit = DEFAULT_LIST_LIMIT,
  before = null,
  unreadOnly = false,
  NotificationModel = Notification,
}) {
  const parsedLimit = Number(limit);
  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

  const query = { user: userId };

  if (unreadOnly) {
    query.readAt = null;
  }

  // Cursor = id of the last notification on the previous page. Ids are
  // unique and increase with creation, unlike createdAt, which one reminder
  // sweep shares across several notifications.
  if (before) {
    if (!mongoose.Types.ObjectId.isValid(before)) {
      throw httpError("before must be a notification id", 400);
    }

    query._id = { $lt: new mongoose.Types.ObjectId(before) };
  }

  const [notifications, unreadCount] = await Promise.all([
    NotificationModel.find(query).sort({ _id: -1 }).limit(safeLimit),
    countUnread(userId, { NotificationModel }),
  ]);

  return {
    notifications: notifications.map(serializeNotification),
    unreadCount,
  };
}

/**
 * Marks one of the caller's notifications as read. Someone else's
 * notification answers 404, exactly like a missing one.
 */
export async function markNotificationRead({
  userId,
  notificationId,
  NotificationModel = Notification,
}) {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw httpError("Notification not found", 404);
  }

  const notification = await NotificationModel.findOne({ _id: notificationId, user: userId });

  if (!notification) {
    throw httpError("Notification not found", 404);
  }

  if (!notification.readAt) {
    notification.readAt = new Date();
    await notification.save();
  }

  const unreadCount = await countUnread(userId, { NotificationModel });

  emitToUsers([userId], REALTIME_EVENTS.NOTIFICATION_READ, {
    notificationIds: [notification._id.toString()],
    unreadCount,
  });

  return { notification: serializeNotification(notification), unreadCount };
}

export async function markAllNotificationsRead({ userId, NotificationModel = Notification }) {
  const result = await NotificationModel.updateMany(
    { user: userId, readAt: null },
    { $set: { readAt: new Date() } },
  );

  // Counted again rather than assumed 0: a notification may have been
  // created between the update and now.
  const unreadCount = await countUnread(userId, { NotificationModel });

  emitToUsers([userId], REALTIME_EVENTS.NOTIFICATION_READ, { all: true, unreadCount });

  return { updated: result.modifiedCount || 0, unreadCount };
}
