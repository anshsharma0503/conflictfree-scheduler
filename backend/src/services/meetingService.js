import mongoose from "mongoose";
import Event from "../models/Event.js";
import Resource from "../models/Resource.js";
import User from "../models/User.js";
import { resolveParticipants } from "./scheduling/participantAvailabilityService.js";
import {
  formatSafeResourceSummary,
  validateResourceForBooking,
} from "./resourceAvailabilityService.js";
import {
  lockResourcesInOrder,
  lockUsersInOrder,
  withSchedulingTransaction,
} from "./scheduling/transactionSchedulingService.js";
import { buildBlockingEventQuery } from "./scheduling/calendarQueryService.js";

export function serializeMeeting(meeting) {
  if (!meeting) return null;

  const resourceId = meeting.resource?._id
    ? meeting.resource._id.toString()
    : meeting.resource
      ? meeting.resource.toString()
      : null;

  const resourceDetails =
    meeting.resource &&
    typeof meeting.resource === "object" &&
    meeting.resource.name
      ? formatSafeResourceSummary(meeting.resource)
      : null;

  const ownerId = meeting.owner?._id
    ? meeting.owner._id.toString()
    : meeting.owner
      ? meeting.owner.toString()
      : null;

  const organizer =
    meeting.owner && typeof meeting.owner === "object" && meeting.owner.email
      ? {
          id: ownerId,
          name: meeting.owner.name || "",
          email: meeting.owner.email || "",
        }
      : null;

  const participants = Array.isArray(meeting.participants)
    ? meeting.participants.map((p) => ({
        user: p.user?._id
          ? p.user._id.toString()
          : p.user
            ? p.user.toString()
            : null,
        email: p.email,
        name: p.name || "",
        status: p.status || "pending",
        respondedAt: p.respondedAt
          ? p.respondedAt instanceof Date
            ? p.respondedAt.toISOString()
            : p.respondedAt
          : null,
      }))
    : [];

  return {
    id: meeting.id || meeting._id?.toString(),
    owner: ownerId,
    organizer,
    title: meeting.title,
    description: meeting.description || "",
    startAt:
      meeting.startAt instanceof Date
        ? meeting.startAt.toISOString()
        : meeting.startAt,
    endAt:
      meeting.endAt instanceof Date
        ? meeting.endAt.toISOString()
        : meeting.endAt,
    timezone: meeting.timezone,
    location: meeting.location || "",
    status: meeting.status || "active",
    participants,
    resource: resourceId,
    resourceDetails,
    createdAt:
      meeting.createdAt instanceof Date
        ? meeting.createdAt.toISOString()
        : meeting.createdAt,
    updatedAt:
      meeting.updatedAt instanceof Date
        ? meeting.updatedAt.toISOString()
        : meeting.updatedAt,
  };
}

export async function confirmSharedMeeting({
  organizerId,
  title,
  description = "",
  startAt,
  endAt,
  timezone = "UTC",
  location = "",
  participantEmails = [],
  resourceId = null,
  attendeeCount = undefined,
  EventModel = Event,
  UserModel = User,
  ResourceModel = Resource,
}) {
  if (!organizerId) {
    const error = new Error("Organizer is required");
    error.status = 400;
    throw error;
  }

  if (!title || typeof title !== "string" || !title.trim()) {
    const error = new Error("Title is required");
    error.status = 400;
    throw error;
  }

  if (!startAt) {
    const error = new Error("startAt is required");
    error.status = 400;
    throw error;
  }

  if (!endAt) {
    const error = new Error("endAt is required");
    error.status = 400;
    throw error;
  }

  const startDate = startAt instanceof Date ? startAt : new Date(startAt);
  const endDate = endAt instanceof Date ? endAt : new Date(endAt);

  if (isNaN(startDate.getTime())) {
    const error = new Error("startAt must be a valid date");
    error.status = 400;
    throw error;
  }

  if (isNaN(endDate.getTime())) {
    const error = new Error("endAt must be a valid date");
    error.status = 400;
    throw error;
  }

  if (endDate <= startDate) {
    const error = new Error("endAt must be after startAt");
    error.status = 400;
    throw error;
  }

  // 1. Resolve registered participants
  const { participants } = await resolveParticipants({
    organizerId,
    participantEmails,
    UserModel,
  });

  // Exclude organizer from the invited participant records
  const invitedSummaries = participants.filter(
    (p) => p.id.toString() !== organizerId.toString(),
  );

  if (invitedSummaries.length === 0) {
    const error = new Error(
      "At least one registered participant is required to confirm a shared meeting",
    );
    error.status = 400;
    throw error;
  }

  // All person IDs to verify conflicts against
  const allUserIds = [
    organizerId,
    ...invitedSummaries.map((p) => new mongoose.Types.ObjectId(p.id)),
  ];

  const normalizedResourceId =
    resourceId && typeof resourceId === "string" && resourceId.trim()
      ? resourceId.trim()
      : resourceId || null;

  return await withSchedulingTransaction(async (session) => {
    // 1. Atomically lock all participants in stable sorted ObjectId order
    await lockUsersInOrder(allUserIds, session, UserModel);

    // 2. Atomically lock resource in stable sorted ObjectId order
    if (normalizedResourceId) {
      await lockResourcesInOrder([normalizedResourceId], session, ResourceModel);
    }

    // 3. Recheck optional resource availability and capacity inside session
    if (normalizedResourceId) {
      await validateResourceForBooking({
        resourceId: normalizedResourceId,
        attendeeCount,
        startAt: startDate,
        endAt: endDate,
        session,
        ResourceModel,
        EventModel,
      });
    }

    // 4. Concurrency recheck inside session: verify no participant has a conflicting event
    const conflictQuery = buildBlockingEventQuery({
      userIds: allUserIds,
      startAt: startDate,
      endAt: endDate,
    });

    let conflictFinder = EventModel.findOne(conflictQuery).select("startAt endAt");
    if (session && typeof conflictFinder.session === "function") {
      conflictFinder = conflictFinder.session(session);
    }
    const conflictingEvent = await conflictFinder;

    if (conflictingEvent) {
      const conflictError = new Error(
        "One or more participants are no longer available for the requested time",
      );
      conflictError.status = 409;
      throw conflictError;
    }

    // 5. Create one canonical shared Event inside session
    const participantRecords = invitedSummaries.map((p) => ({
      user: new mongoose.Types.ObjectId(p.id),
      email: p.email,
      name: p.name || "",
      status: "pending",
      respondedAt: null,
    }));

    const meetingDoc = new EventModel({
      owner: organizerId,
      title: title.trim(),
      description: description ? description.trim() : "",
      startAt: startDate,
      endAt: endDate,
      timezone: timezone || "UTC",
      location: location ? location.trim() : "",
      participants: participantRecords,
      status: "active",
      resource: normalizedResourceId,
    });

    await meetingDoc.save({ session });

    if (normalizedResourceId) {
      await meetingDoc.populate({ path: "resource", session });
    }

    await meetingDoc.populate({ path: "owner", select: "name email", session });

    return serializeMeeting(meetingDoc);
  });
}

export async function listPendingInvitations({
  userId,
  userEmail,
  EventModel = Event,
}) {
  if (!userId) {
    const error = new Error("userId is required");
    error.status = 400;
    throw error;
  }

  const userObjectId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  // Invitations are matched by the verified registered-user reference only.
  // Matching by free-text email would let anyone place items in another
  // user's inbox by typing their address.
  const query = {
    status: { $ne: "cancelled" },
    owner: { $ne: userObjectId },
    participants: {
      $elemMatch: {
        user: userObjectId,
        status: "pending",
      },
    },
  };

  const invitations = await EventModel.find(query)
    .populate("resource")
    .populate("owner", "name email")
    .sort({ startAt: 1 });

  return invitations.map(serializeMeeting);
}

export async function respondToInvitation({
  meetingId,
  userId,
  userEmail,
  status,
  EventModel = Event,
  UserModel = User,
}) {
  if (!status || !["accepted", "declined"].includes(status)) {
    const error = new Error("Status must be either 'accepted' or 'declined'");
    error.status = 400;
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(meetingId)) {
    const error = new Error("Meeting not found");
    error.status = 404;
    throw error;
  }

  return await withSchedulingTransaction(async (session) => {
    // 1. Lock the responding user to avoid race conditions with newly scheduled conflicting events
    await lockUsersInOrder([userId], session, UserModel);

    let meetingFinder = EventModel.findById(meetingId)
      .populate("resource")
      .populate("owner", "name email");

    if (session && typeof meetingFinder.session === "function") {
      meetingFinder = meetingFinder.session(session);
    }

    const meeting = await meetingFinder;

    if (!meeting) {
      const error = new Error("Meeting not found");
      error.status = 404;
      throw error;
    }

    if (meeting.status === "cancelled") {
      const error = new Error("Cannot respond to a cancelled meeting");
      error.status = 400;
      throw error;
    }

    const organizerIdStr = meeting.owner?._id
      ? meeting.owner._id.toString()
      : meeting.owner?.toString();

    if (organizerIdStr === userId.toString()) {
      const error = new Error(
        "Organizer cannot respond to their own meeting invitation",
      );
      error.status = 400;
      throw error;
    }

    const participant = meeting.participants.find(
      (p) => p.user && p.user.toString() === userId.toString(),
    );

    if (!participant) {
      const error = new Error("You are not invited to this meeting");
      error.status = 403;
      throw error;
    }

    if (participant.status !== "pending") {
      const error = new Error("Invitation has already been responded to");
      error.status = 400;
      throw error;
    }

    // On accept, verify participant has no newly created conflicting event
    if (status === "accepted") {
      const conflictQuery = buildBlockingEventQuery({
        userIds: [userId],
        startAt: meeting.startAt,
        endAt: meeting.endAt,
        excludeEventId: meeting._id,
      });

      let conflictFinder = EventModel.findOne(conflictQuery).select("startAt endAt");
      if (session && typeof conflictFinder.session === "function") {
        conflictFinder = conflictFinder.session(session);
      }
      const conflictingEvent = await conflictFinder;

      if (conflictingEvent) {
        const error = new Error(
          "You have a conflicting event during this meeting time",
        );
        error.status = 409;
        throw error;
      }
    }

    participant.status = status;
    participant.respondedAt = new Date();

    await meeting.save({ session });

    return serializeMeeting(meeting);
  });
}

export async function cancelMeeting({
  meetingId,
  userId,
  EventModel = Event,
  UserModel = User,
  ResourceModel = Resource,
}) {
  if (!mongoose.Types.ObjectId.isValid(meetingId)) {
    const error = new Error("Meeting not found");
    error.status = 404;
    throw error;
  }

  const initialMeeting = await EventModel.findById(meetingId);

  if (!initialMeeting) {
    const error = new Error("Meeting not found");
    error.status = 404;
    throw error;
  }

  const organizerIdStr = initialMeeting.owner?._id
    ? initialMeeting.owner._id.toString()
    : initialMeeting.owner?.toString();

  if (organizerIdStr !== userId.toString()) {
    const error = new Error("Only the organizer can cancel this meeting");
    error.status = 403;
    throw error;
  }

  if (initialMeeting.status === "cancelled") {
    const error = new Error("Meeting is already cancelled");
    error.status = 400;
    throw error;
  }

  const affectedUserIds = [
    initialMeeting.owner,
    ...initialMeeting.participants.map((p) => p.user).filter(Boolean),
  ];

  return await withSchedulingTransaction(async (session) => {
    // 1. Lock all affected participants
    await lockUsersInOrder(affectedUserIds, session, UserModel);

    // 2. Lock resource if booked
    if (initialMeeting.resource) {
      await lockResourcesInOrder([initialMeeting.resource], session, ResourceModel);
    }

    let meetingFinder = EventModel.findById(meetingId)
      .populate("resource")
      .populate("owner", "name email");

    if (session && typeof meetingFinder.session === "function") {
      meetingFinder = meetingFinder.session(session);
    }

    const meeting = await meetingFinder;

    if (!meeting) {
      const error = new Error("Meeting not found");
      error.status = 404;
      throw error;
    }

    if (meeting.status === "cancelled") {
      const error = new Error("Meeting is already cancelled");
      error.status = 400;
      throw error;
    }

    meeting.status = "cancelled";
    await meeting.save({ session });

    return serializeMeeting(meeting);
  });
}

