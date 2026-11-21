import Event from "../../models/Event.js";
import Resource from "../../models/Resource.js";
import { buildBlockingEventQuery } from "./calendarQueryService.js";
import { SegmentTree } from "./segmentTreeService.js";
import { rankSlots } from "./slotScoringService.js";
import {
  allocateResourceForCandidateSlot,
  fetchEligibleResources,
  fetchOverlappingResourceBookings,
} from "./resourceGraphColoringService.js";

export function normalizeSlotSearchInput({
  windowStart,
  windowEnd,
  durationMinutes,
  slotStepMinutes,
}) {
  if (!windowStart) {
    throw new Error("windowStart is required");
  }

  if (!windowEnd) {
    throw new Error("windowEnd is required");
  }

  const start = new Date(windowStart);
  const end = new Date(windowEnd);

  if (isNaN(start.getTime())) {
    throw new Error("windowStart must be a valid date");
  }

  if (isNaN(end.getTime())) {
    throw new Error("windowEnd must be a valid date");
  }

  if (end <= start) {
    throw new Error("windowEnd must be after windowStart");
  }

  if (
    durationMinutes === undefined ||
    durationMinutes === null ||
    durationMinutes === ""
  ) {
    throw new Error("durationMinutes is required");
  }

  const duration = Number(durationMinutes);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("durationMinutes must be positive");
  }

  let step = 30;

  if (
    slotStepMinutes !== undefined &&
    slotStepMinutes !== null &&
    slotStepMinutes !== ""
  ) {
    step = Number(slotStepMinutes);

    if (!Number.isFinite(step) || step <= 0) {
      throw new Error("slotStepMinutes must be positive");
    }
  }

  return {
    windowStart: start,
    windowEnd: end,
    durationMinutes: duration,
    slotStepMinutes: step,
  };
}

export function buildBusyRanges(events = []) {
  return events.map((event) => ({
    start: event.startAt instanceof Date ? event.startAt : new Date(event.startAt),
    end: event.endAt instanceof Date ? event.endAt : new Date(event.endAt),
  }));
}

export function slotOverlapsBusyRange(slot, busyRange) {
  const slotStart = slot.start instanceof Date ? slot.start : new Date(slot.start);
  const slotEnd = slot.end instanceof Date ? slot.end : new Date(slot.end);
  const busyStart =
    busyRange.start instanceof Date ? busyRange.start : new Date(busyRange.start);
  const busyEnd =
    busyRange.end instanceof Date ? busyRange.end : new Date(busyRange.end);

  return slotStart < busyEnd && slotEnd > busyStart;
}

export function isSlotAvailable(slot, busyRangesOrTree = []) {
  if (busyRangesOrTree && typeof busyRangesOrTree.isRangeFree === "function") {
    return busyRangesOrTree.isRangeFree(slot);
  }

  const ranges = Array.isArray(busyRangesOrTree) ? busyRangesOrTree : [];
  for (const busyRange of ranges) {
    if (slotOverlapsBusyRange(slot, busyRange)) {
      return false;
    }
  }

  return true;
}

export async function findAvailableSlots({
  ownerId,
  ownerIds,
  windowStart,
  windowEnd,
  durationMinutes,
  slotStepMinutes,
  preferences = {},
  additionalBusyRanges = [],
  autoAllocateResource = false,
  resourceType,
  attendeeCount,
  EventModel = Event,
  ResourceModel = Resource,
}) {
  const normalized = normalizeSlotSearchInput({
    windowStart,
    windowEnd,
    durationMinutes,
    slotStepMinutes,
  });

  const durationMs = normalized.durationMinutes * 60 * 1000;
  const stepMs = normalized.slotStepMinutes * 60 * 1000;
  const windowStartMs = normalized.windowStart.getTime();
  const windowEndMs = normalized.windowEnd.getTime();

  if (durationMs > windowEndMs - windowStartMs) {
    return [];
  }

  let eligiblePalette = [];
  let overlappingResourceEvents = [];

  if (autoAllocateResource) {
    eligiblePalette = await fetchEligibleResources({
      resourceType,
      attendeeCount,
      ResourceModel,
    });

    if (eligiblePalette.length === 0) {
      return [];
    }

    overlappingResourceEvents = await fetchOverlappingResourceBookings({
      windowStart: normalized.windowStart,
      windowEnd: normalized.windowEnd,
      EventModel,
    });
  }

  const resolvedOwnerIds = Array.isArray(ownerIds) && ownerIds.length > 0
    ? ownerIds
    : ownerId
      ? [ownerId]
      : [];

  let query;
  if (EventModel === Event) {
    query = buildBlockingEventQuery({
      userIds: resolvedOwnerIds,
      startAt: normalized.windowStart,
      endAt: normalized.windowEnd,
    });
  } else {
    query = {
      owner: resolvedOwnerIds.length === 1 ? resolvedOwnerIds[0] : { $in: resolvedOwnerIds },
      startAt: { $lt: normalized.windowEnd },
      endAt: { $gt: normalized.windowStart },
    };
  }

  let queryBuilder = EventModel.find(query);

  if (typeof queryBuilder.select === "function") {
    queryBuilder = queryBuilder.select("startAt endAt");
  }

  const overlappingEvents = typeof queryBuilder.sort === "function"
    ? await queryBuilder.sort({ startAt: 1 })
    : await queryBuilder;

  const userBusyRanges = buildBusyRanges(overlappingEvents);
  const allBusyRanges = [...userBusyRanges, ...(Array.isArray(additionalBusyRanges) ? additionalBusyRanges : [])];

  const tree = new SegmentTree({
    windowStart: normalized.windowStart,
    windowEnd: normalized.windowEnd,
    stepMinutes: normalized.slotStepMinutes,
  });

  for (const busyRange of allBusyRanges) {
    tree.addBusyRange(busyRange);
  }

  const availableSlots = [];
  let currentStartMs = windowStartMs;

  while (currentStartMs + durationMs <= windowEndMs) {
    const slotStart = new Date(currentStartMs);
    const slotEnd = new Date(currentStartMs + durationMs);

    if (isSlotAvailable({ start: slotStart, end: slotEnd }, tree)) {
      if (autoAllocateResource) {
        const allocation = allocateResourceForCandidateSlot({
          candidateSlot: { startAt: slotStart, endAt: slotEnd },
          overlappingEvents: overlappingResourceEvents,
          eligiblePalette,
          attendeeCount,
        });

        if (allocation) {
          availableSlots.push({
            startAt: slotStart,
            endAt: slotEnd,
            allocatedResource: allocation.allocatedResource,
            allocationReason: allocation.allocationReason,
          });
        }
      } else {
        availableSlots.push({
          startAt: slotStart,
          endAt: slotEnd,
        });
      }
    }

    currentStartMs += stepMs;
  }

  return rankSlots(availableSlots, preferences);
}
