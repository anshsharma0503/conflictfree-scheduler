// Job processors run by the BullMQ workers. They are plain async functions
// that take a job-like object ({ id, name, data }), so tests can call them
// directly without Redis.
//
// Jobs carry ids only (plus a minimal snapshot for deleted meetings). Every
// processor reloads the canonical record from MongoDB, so a job never
// notifies about data that changed or that the recipient may no longer see.
import Event from "../models/Event.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import User, { DEFAULT_REMINDER_MINUTES, REMINDER_LEAD_OPTIONS } from "../models/User.js";
import {
  buildMeetingNotifications,
  getReminderRecipientIds,
  selectDueReminders,
} from "../services/notifications/notificationRules.js";
import { deliverNotifications } from "../services/notifications/notificationService.js";

const MAX_REMINDER_LEAD_MINUTES = Math.max(...REMINDER_LEAD_OPTIONS);

/**
 * Turns one domain event (meeting confirmed, RSVP, update, cancellation,
 * deletion) into stored in-app notifications and live pushes.
 */
export async function processNotificationJob(job, { EventModel = Event, UserModel = User } = {}) {
  const type = job.name;
  const data = job.data || {};

  if (!job.id) {
    throw new Error("Notification jobs need a stable id for deduplication");
  }

  // A deleted meeting can no longer be loaded, so its job carries a snapshot.
  if (data.deleted) {
    const snapshot = data.snapshot || {};
    const organizer = await UserModel.findById(snapshot.ownerId).select("name email").lean();

    const records = buildMeetingNotifications({
      type,
      meeting: {
        owner: snapshot.ownerId,
        title: snapshot.title,
        startAt: snapshot.startAt ? new Date(snapshot.startAt) : null,
        endAt: snapshot.endAt ? new Date(snapshot.endAt) : null,
        participants: (snapshot.participantIds || []).map((user) => ({ user })),
      },
      organizer,
      dedupeId: job.id,
      deleted: true,
    });

    const created = await deliverNotifications(records);
    return { created: created.length };
  }

  const meeting = await EventModel.findById(data.eventId)
    .populate("owner", "name email")
    .lean();

  if (!meeting) {
    return { created: 0, skipped: "event_not_found" };
  }

  // A cancelled meeting only produces its cancellation notice.
  if (meeting.status === "cancelled" && type !== NOTIFICATION_TYPES.MEETING_CANCELLED) {
    return { created: 0, skipped: "meeting_cancelled" };
  }

  let responder = null;

  if (type === NOTIFICATION_TYPES.INVITATION_RESPONDED) {
    const responderUser = await UserModel.findById(data.responderId).select("name email").lean();
    responder = responderUser
      ? { id: data.responderId, name: responderUser.name, email: responderUser.email }
      : { id: data.responderId };
  }

  const records = buildMeetingNotifications({
    type,
    meeting: { ...meeting, owner: meeting.owner?._id || meeting.owner },
    organizer: meeting.owner,
    dedupeId: job.id,
    responder,
    status: data.status,
    changes: data.changes || [],
  });

  const created = await deliverNotifications(records);
  return { created: created.length };
}

/**
 * Creates every reminder that is due at `now`. Safe to run as often as
 * needed: reminders are deduplicated per user, event and start time, and a
 * sweep that runs late still catches events that have not started yet.
 */
export async function runReminderSweep({
  now = new Date(),
  EventModel = Event,
  UserModel = User,
} = {}) {
  const windowEnd = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);

  const events = await EventModel.find({
    status: { $ne: "cancelled" },
    startAt: { $gt: now, $lte: windowEnd },
  })
    .select("owner title startAt endAt status participants")
    .lean();

  if (events.length === 0) {
    return { scanned: 0, created: 0 };
  }

  const userIds = Array.from(new Set(events.flatMap(getReminderRecipientIds)));
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("reminderMinutesBefore")
    .lean();

  const leadByUserId = new Map(
    users.map((user) => [
      user._id.toString(),
      user.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES,
    ]),
  );

  const due = selectDueReminders({ events, leadByUserId, now });
  const created = await deliverNotifications(due);

  return { scanned: events.length, created: created.length };
}
