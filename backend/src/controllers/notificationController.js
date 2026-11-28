import User, { DEFAULT_REMINDER_MINUTES, REMINDER_LEAD_OPTIONS } from "../models/User.js";
import { getQueueStatus } from "../queues/queueService.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notifications/notificationService.js";

function sendError(res, error) {
  return res.status(error.status || 400).json({
    success: false,
    message: error.message,
  });
}

function serializePreferences(user) {
  return {
    reminderMinutesBefore: user.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES,
    reminderOptions: REMINDER_LEAD_OPTIONS,
    // Lets the UI say when reminders cannot be delivered (no Redis).
    deliveryStatus: getQueueStatus(),
  };
}

export async function getNotifications(req, res) {
  try {
    const result = await listNotifications({
      userId: req.user.id,
      limit: req.query.limit,
      before: req.query.before,
      unreadOnly: req.query.unread === "true",
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function readNotification(req, res) {
  try {
    const result = await markNotificationRead({
      userId: req.user.id,
      notificationId: req.params.id,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function readAllNotifications(req, res) {
  try {
    const result = await markAllNotificationsRead({ userId: req.user.id });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getPreferences(req, res) {
  const user = await User.findById(req.user.id).select("reminderMinutesBefore");

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  return res.status(200).json({ success: true, preferences: serializePreferences(user) });
}

export async function updatePreferences(req, res) {
  const value = req.body?.reminderMinutesBefore;

  if (!Number.isInteger(value) || !REMINDER_LEAD_OPTIONS.includes(value)) {
    return res.status(400).json({
      success: false,
      message: `reminderMinutesBefore must be one of: ${REMINDER_LEAD_OPTIONS.join(", ")}`,
    });
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { $set: { reminderMinutesBefore: value } },
    { returnDocument: "after", runValidators: true },
  ).select("reminderMinutesBefore");

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  return res.status(200).json({ success: true, preferences: serializePreferences(user) });
}
