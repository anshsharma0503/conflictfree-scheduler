import mongoose from "mongoose";
import Event from "../models/Event.js";
import {
  publishEventCreated,
  publishEventDeleted,
  publishEventUpdated,
} from "../services/schedulingEvents.js";
import {
  formatSafeResourceSummary,
  validateResourceForBooking,
} from "../services/resourceAvailabilityService.js";
import {
  lockResourcesInOrder,
  lockUsersInOrder,
  withSchedulingTransaction,
} from "../services/scheduling/transactionSchedulingService.js";
import {
  buildBlockingEventQuery,
  buildEventVisibilityMatcher,
  getMeetingOccupantIds,
} from "../services/scheduling/calendarQueryService.js";

const PARTICIPANTS_MANAGED_MESSAGE =
  "Participants cannot be set on personal events. Use POST /api/meetings/confirm to invite registered participants.";

function hasClientParticipants(body) {
  return Array.isArray(body.participants)
    ? body.participants.length > 0
    : body.participants !== undefined && body.participants !== null;
}

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function serializeEvent(event) {
  const resourceId = event.resource?._id
    ? event.resource._id.toString()
    : event.resource
      ? event.resource.toString()
      : null;

  const resourceDetails =
    event.resource && typeof event.resource === "object" && event.resource.name
      ? formatSafeResourceSummary(event.resource)
      : null;

  const ownerId = event.owner?._id
    ? event.owner._id.toString()
    : event.owner
      ? event.owner.toString()
      : null;

  const organizer =
    event.owner && typeof event.owner === "object" && event.owner.email
      ? {
          id: ownerId,
          name: event.owner.name || "",
          email: event.owner.email || "",
        }
      : null;

  const participants = Array.isArray(event.participants)
    ? event.participants.map((p) => ({
        user: p.user?._id ? p.user._id.toString() : p.user ? p.user.toString() : null,
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
    id: event.id,
    owner: ownerId,
    organizer,
    title: event.title,
    description: event.description,
    startAt: event.startAt?.toISOString(),
    endAt: event.endAt?.toISOString(),
    timezone: event.timezone,
    location: event.location,
    status: event.status || "active",
    participants,
    resource: resourceId,
    resourceDetails,
    source: event.source,
    googleEventId: event.googleEventId,
    createdAt: event.createdAt?.toISOString(),
    updatedAt: event.updatedAt?.toISOString(),
  };
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function getEventUpdatePayload(body) {
  const allowedFields = [
    "title",
    "description",
    "startAt",
    "endAt",
    "timezone",
    "location",
  ];

  return allowedFields.reduce((payload, field) => {
    if (body[field] !== undefined) {
      payload[field] = body[field];
    }

    return payload;
  }, {});
}

export async function createEvent(req, res) {
  try {
    if (hasClientParticipants(req.body)) {
      throw createHttpError(PARTICIPANTS_MANAGED_MESSAGE, 400);
    }

    const rawResourceId =
      req.body.resourceId !== undefined ? req.body.resourceId : req.body.resource;
    const resourceId = rawResourceId && typeof rawResourceId === "string" && rawResourceId.trim()
      ? rawResourceId.trim()
      : null;

    if (resourceId) {
      const event = await withSchedulingTransaction(async (session) => {
        await lockUsersInOrder([req.user.id], session);
        await lockResourcesInOrder([resourceId], session);

        await validateResourceForBooking({
          resourceId,
          attendeeCount: req.body.attendeeCount,
          startAt: req.body.startAt,
          endAt: req.body.endAt,
          session,
        });

        const newEvent = new Event({
          owner: req.user.id,
          title: req.body.title,
          description: req.body.description,
          startAt: req.body.startAt,
          endAt: req.body.endAt,
          timezone: req.body.timezone,
          location: req.body.location,
          participants: [],
          resource: resourceId,
        });

        await newEvent.save({ session });
        await newEvent.populate({ path: "resource", session });
        return newEvent;
      });

      const serialized = serializeEvent(event);
      publishEventCreated(serialized);

      return res.status(201).json({
        success: true,
        event: serialized,
      });
    }

    const event = await Event.create({
      owner: req.user.id,
      title: req.body.title,
      description: req.body.description,
      startAt: req.body.startAt,
      endAt: req.body.endAt,
      timezone: req.body.timezone,
      location: req.body.location,
      participants: [],
      resource: null,
    });

    const serialized = serializeEvent(event);
    publishEventCreated(serialized);

    return res.status(201).json({
      success: true,
      event: serialized,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function listEvents(req, res) {
  const events = await Event.find({
    $or: buildEventVisibilityMatcher(req.user.id),
  })
    .populate("resource")
    .populate("owner", "name email")
    .sort({
      startAt: 1,
    });

  return res.status(200).json({
    success: true,
    events: events.map(serializeEvent),
  });
}

export async function getEventById(req, res) {
  if (!isValidObjectId(req.params.id)) {
    return res.status(404).json({
      success: false,
      message: "Event not found",
    });
  }

  const event = await Event.findOne({
    _id: req.params.id,
    $or: buildEventVisibilityMatcher(req.user.id),
  })
    .populate("resource")
    .populate("owner", "name email");

  if (!event) {
    return res.status(404).json({
      success: false,
      message: "Event not found",
    });
  }

  return res.status(200).json({
    success: true,
    event: serializeEvent(event),
  });
}

export async function updateEvent(req, res) {
  if (!isValidObjectId(req.params.id)) {
    return res.status(404).json({
      success: false,
      message: "Event not found",
    });
  }

  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (event.owner.toString() !== req.user.id) {
      const isParticipant = event.participants?.some(
        (p) => p.user && p.user.toString() === req.user.id,
      );

      if (isParticipant) {
        return res.status(403).json({
          success: false,
          message: "Only the organizer can edit this meeting",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (hasClientParticipants(req.body)) {
      throw createHttpError(
        "Participants of a meeting cannot be changed through event updates.",
        400,
      );
    }

    if (event.status === "cancelled") {
      throw createHttpError("Cannot edit a cancelled meeting", 400);
    }

    const previousState = {
      previousResourceId: event.resource ? event.resource.toString() : null,
      previousStartAt: event.startAt,
      previousEndAt: event.endAt,
    };

    const hasNewResourceId =
      req.body.resourceId !== undefined || req.body.resource !== undefined;
    const rawNewResourceId =
      req.body.resourceId !== undefined ? req.body.resourceId : req.body.resource;
    const normalizedNewResourceId =
      rawNewResourceId && typeof rawNewResourceId === "string" && rawNewResourceId.trim()
        ? rawNewResourceId.trim()
        : rawNewResourceId || null;

    const targetResourceId = hasNewResourceId
      ? normalizedNewResourceId
      : event.resource;

    const targetStartAt =
      req.body.startAt !== undefined ? req.body.startAt : event.startAt;
    const targetEndAt =
      req.body.endAt !== undefined ? req.body.endAt : event.endAt;

    const involvesResourcesOrParticipants =
      Boolean(event.resource) ||
      Boolean(targetResourceId) ||
      (Array.isArray(event.participants) &&
        event.participants.some((p) => Boolean(p.user)));

    if (involvesResourcesOrParticipants) {
      const resourcesToLock = Array.from(
        new Set([event.resource, targetResourceId].filter(Boolean)),
      );
      const usersToLock = [
        event.owner,
        ...(event.participants || []).map((p) => p.user).filter(Boolean),
      ];

      const timeChanged =
        new Date(targetStartAt).getTime() !== event.startAt.getTime() ||
        new Date(targetEndAt).getTime() !== event.endAt.getTime();
      const isSharedMeeting = (event.participants || []).some((p) => Boolean(p.user));

      await withSchedulingTransaction(async (session) => {
        await lockUsersInOrder(usersToLock, session);
        if (resourcesToLock.length > 0) {
          await lockResourcesInOrder(resourcesToLock, session);
        }

        // Moving a shared meeting must not double-book the organizer or any
        // participant whose invitation still reserves their time.
        if (isSharedMeeting && timeChanged) {
          const startDate = new Date(targetStartAt);
          const endDate = new Date(targetEndAt);

          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw createHttpError("startAt and endAt must be valid dates", 400);
          }

          const conflict = await Event.findOne(
            buildBlockingEventQuery({
              userIds: getMeetingOccupantIds(event),
              startAt: startDate,
              endAt: endDate,
              excludeEventId: event._id,
            }),
          )
            .select("_id")
            .session(session);

          if (conflict) {
            throw createHttpError(
              "One or more participants are not available for the requested time",
              409,
            );
          }
        }

        if (targetResourceId) {
          await validateResourceForBooking({
            resourceId: targetResourceId,
            attendeeCount: req.body.attendeeCount,
            startAt: targetStartAt,
            endAt: targetEndAt,
            excludeEventId: event._id,
            session,
          });
        }

        const updatePayload = getEventUpdatePayload(req.body);

        if (hasNewResourceId) {
          updatePayload.resource = targetResourceId;
        }

        Object.assign(event, updatePayload);

        await event.save({ session });
        if (event.resource) {
          await event.populate({ path: "resource", session });
        }
      });

      const serialized = serializeEvent(event);
      publishEventUpdated(serialized, previousState);

      return res.status(200).json({
        success: true,
        event: serialized,
      });
    }

    if (targetResourceId) {
      await validateResourceForBooking({
        resourceId: targetResourceId,
        attendeeCount: req.body.attendeeCount,
        startAt: targetStartAt,
        endAt: targetEndAt,
        excludeEventId: event._id,
      });
    }

    const updatePayload = getEventUpdatePayload(req.body);

    if (hasNewResourceId) {
      updatePayload.resource = targetResourceId;
    }

    Object.assign(event, updatePayload);

    await event.save();
    if (event.resource) {
      await event.populate("resource");
    }

    const serialized = serializeEvent(event);
    publishEventUpdated(serialized, previousState);

    return res.status(200).json({
      success: true,
      event: serialized,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function deleteEvent(req, res) {
  if (!isValidObjectId(req.params.id)) {
    return res.status(404).json({
      success: false,
      message: "Event not found",
    });
  }

  const event = await Event.findById(req.params.id);

  if (!event) {
    return res.status(404).json({
      success: false,
      message: "Event not found",
    });
  }

  if (event.owner.toString() !== req.user.id) {
    const isParticipant = event.participants?.some(
      (p) => p.user && p.user.toString() === req.user.id,
    );

    if (isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Only the organizer can delete this meeting",
      });
    }

    return res.status(404).json({
      success: false,
      message: "Event not found",
    });
  }

  if (event.resource) {
    await withSchedulingTransaction(async (session) => {
      await lockUsersInOrder([event.owner], session);
      await lockResourcesInOrder([event.resource], session);
      await event.deleteOne({ session });
    });
  } else {
    await event.deleteOne();
  }

  publishEventDeleted(event);

  return res.status(200).json({
    success: true,
    message: "Event deleted successfully",
  });
}
