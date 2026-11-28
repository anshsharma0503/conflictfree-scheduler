import mongoose from "mongoose";

export const NOTIFICATION_TYPES = Object.freeze({
  INVITATION_CREATED: "invitation.created",
  INVITATION_RESPONDED: "invitation.responded",
  MEETING_UPDATED: "meeting.updated",
  MEETING_CANCELLED: "meeting.cancelled",
  EVENT_REMINDER: "event.reminder",
});

// In-app notifications are kept for 90 days, then MongoDB removes them.
export const NOTIFICATION_RETENTION_SECONDS = 90 * 24 * 60 * 60;

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      default: null,
    },
    // Display data captured when the notification was created (the event can
    // change or be deleted later). Only data the recipient could already read.
    data: {
      eventTitle: { type: String, default: "" },
      startAt: { type: Date, default: null },
      endAt: { type: Date, default: null },
      actorName: { type: String, default: "" },
      status: { type: String, default: "" },
    },
    // Unique per user. A retried job or a repeated reminder sweep writes the
    // same key, so a notification is never created twice.
    dedupeKey: {
      type: String,
      required: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ user: 1, _id: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_RETENTION_SECONDS },
);

const Notification =
  mongoose.models.Notification || mongoose.model("Notification", notificationSchema);

export default Notification;
