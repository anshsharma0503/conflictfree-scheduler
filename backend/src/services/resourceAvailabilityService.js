import mongoose from "mongoose";
import Event from "../models/Event.js";
import Resource from "../models/Resource.js";

export function formatSafeResourceSummary(resource) {
  if (!resource) return null;
  return {
    id: resource._id ? resource._id.toString() : resource.id,
    name: resource.name,
    type: resource.type,
    capacity: resource.capacity,
    location: resource.location || "",
  };
}

export async function validateResourceForBooking(
  {
    resourceId,
    attendeeCount,
    startAt,
    endAt,
    excludeEventId,
    session = null,
    ResourceModel = Resource,
    EventModel = Event,
  } = {},
) {
  if (!resourceId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(resourceId)) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  let resourceQuery = ResourceModel.findById(resourceId);
  if (session && typeof resourceQuery.session === "function") {
    resourceQuery = resourceQuery.session(session);
  }
  const resource = await resourceQuery;
  if (!resource) {
    const error = new Error("Resource not found");
    error.status = 404;
    throw error;
  }

  if (!resource.isActive) {
    const error = new Error("Resource is deactivated and cannot be selected");
    error.status = 400;
    throw error;
  }

  if (attendeeCount !== undefined && attendeeCount !== null && attendeeCount !== "") {
    const count = Number(attendeeCount);
    if (!Number.isInteger(count) || count < 1) {
      const error = new Error("Attendee count must be a positive integer");
      error.status = 400;
      throw error;
    }
    if (count > resource.capacity) {
      const error = new Error(
        `Attendee count (${count}) exceeds resource capacity (${resource.capacity})`,
      );
      error.status = 400;
      throw error;
    }
  }

  if (startAt && endAt) {
    const startDate = startAt instanceof Date ? startAt : new Date(startAt);
    const endDate = endAt instanceof Date ? endAt : new Date(endAt);

    const query = {
      resource: resource._id,
      status: { $ne: "cancelled" },
      startAt: { $lt: endDate },
      endAt: { $gt: startDate },
    };

    if (excludeEventId && mongoose.Types.ObjectId.isValid(excludeEventId)) {
      query._id = { $ne: excludeEventId };
    }

    let conflictQuery = EventModel.findOne(query).select("startAt endAt");
    if (session && typeof conflictQuery.session === "function") {
      conflictQuery = conflictQuery.session(session);
    }
    const conflictingEvent = await conflictQuery;
    if (conflictingEvent) {
      const conflictError = new Error("Resource is already booked for the requested time");
      conflictError.status = 409;
      throw conflictError;
    }
  }

  return resource;
}

export async function findResourceBusyRanges({
  resourceId,
  windowStart,
  windowEnd,
  excludeEventId,
  EventModel = Event,
} = {}) {
  if (!resourceId) {
    return [];
  }

  const query = {
    resource: resourceId,
    status: { $ne: "cancelled" },
    startAt: { $lt: windowEnd },
    endAt: { $gt: windowStart },
  };

  if (excludeEventId && mongoose.Types.ObjectId.isValid(excludeEventId)) {
    query._id = { $ne: excludeEventId };
  }

  let queryBuilder = EventModel.find(query);
  if (typeof queryBuilder.select === "function") {
    queryBuilder = queryBuilder.select("startAt endAt");
  }

  const events = await queryBuilder;
  return events.map((event) => ({
    start: event.startAt instanceof Date ? event.startAt : new Date(event.startAt),
    end: event.endAt instanceof Date ? event.endAt : new Date(event.endAt),
  }));
}

