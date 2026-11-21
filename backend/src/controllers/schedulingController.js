import { findConflictingEvents } from "../services/scheduling/conflictDetectionService.js";
import { findAvailableSlots } from "../services/scheduling/availableSlotService.js";
import { findSuggestionsWithRelaxation } from "../services/scheduling/backtrackingSchedulingService.js";
import { resolveParticipants } from "../services/scheduling/participantAvailabilityService.js";
import {
  findResourceBusyRanges,
  formatSafeResourceSummary,
  validateResourceForBooking,
} from "../services/resourceAvailabilityService.js";
import { normalizeTimezone } from "../services/timezoneService.js";

export async function checkConflicts(req, res) {
  const { startAt, endAt, excludeEventId } = req.body;

  try {
    const conflicts = await findConflictingEvents({
      ownerId: req.user.id,
      startAt,
      endAt,
      excludeEventId,
    });

    const serializedConflicts = conflicts.map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt instanceof Date
        ? event.startAt.toISOString()
        : event.startAt,
      endAt: event.endAt instanceof Date
        ? event.endAt.toISOString()
        : event.endAt,
      location: event.location,
    }));

    return res.status(200).json({
      success: true,
      hasConflict: serializedConflicts.length > 0,
      conflicts: serializedConflicts,
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function findSlots(req, res) {
  const {
    windowStart,
    windowEnd,
    durationMinutes,
    slotStepMinutes,
    preferences = {},
    participantEmails,
    resourceId,
    attendeeCount,
    autoAllocateResource,
    resourceType,
  } = req.body;

  try {
    if (resourceId && autoAllocateResource) {
      return res.status(400).json({
        success: false,
        message: "Cannot specify both resourceId and autoAllocateResource",
      });
    }

    if (autoAllocateResource) {
      if (
        resourceType !== undefined &&
        resourceType !== null &&
        resourceType !== ""
      ) {
        if (resourceType !== "room" && resourceType !== "equipment") {
          return res.status(400).json({
            success: false,
            message: "resourceType must be either 'room' or 'equipment'",
          });
        }
      }

      if (
        attendeeCount !== undefined &&
        attendeeCount !== null &&
        attendeeCount !== ""
      ) {
        const count = Number(attendeeCount);
        if (!Number.isInteger(count) || count < 1) {
          return res.status(400).json({
            success: false,
            message: "Attendee count must be a positive integer",
          });
        }
      }
    }

    const { participants, userIds } = await resolveParticipants({
      organizerId: req.user.id,
      organizerFallback: {
        _id: req.user.id,
        name: req.user.name || "Organizer",
        email: req.user.email || "",
        timezone: "UTC",
      },
      participantEmails,
    });

    const organizer = participants[0];
    const authoritativeTimezone = normalizeTimezone(organizer?.timezone, "UTC");

    const mergedPreferences = {
      ...preferences,
      timezone: preferences.timezone
        ? normalizeTimezone(preferences.timezone, authoritativeTimezone)
        : authoritativeTimezone,
    };

    let safeResource = null;
    let resourceBusyRanges = [];

    if (resourceId) {
      const validatedResource = await validateResourceForBooking({
        resourceId,
        attendeeCount,
      });
      safeResource = formatSafeResourceSummary(validatedResource);
      resourceBusyRanges = await findResourceBusyRanges({
        resourceId,
        windowStart,
        windowEnd,
      });
    }

    const slots = await findAvailableSlots({
      ownerIds: userIds,
      windowStart,
      windowEnd,
      durationMinutes,
      slotStepMinutes,
      preferences: mergedPreferences,
      additionalBusyRanges: resourceBusyRanges,
      autoAllocateResource: Boolean(autoAllocateResource),
      resourceType,
      attendeeCount,
    });

    const serializedSlots = slots.map((slot) => {
      const item = {
        startAt:
          slot.startAt instanceof Date ? slot.startAt.toISOString() : slot.startAt,
        endAt:
          slot.endAt instanceof Date ? slot.endAt.toISOString() : slot.endAt,
        score: typeof slot.score === "number" ? slot.score : 50,
        reasons: Array.isArray(slot.reasons) ? slot.reasons : [],
      };
      if (slot.allocatedResource) {
        item.allocatedResource = slot.allocatedResource;
        item.allocationReason = slot.allocationReason;
      }
      return item;
    });

    const responsePayload = {
      success: true,
      participants,
      slots: serializedSlots,
    };

    if (safeResource) {
      responsePayload.resource = safeResource;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}

export async function suggestSlots(req, res) {
  const {
    windowStart,
    windowEnd,
    durationMinutes,
    slotStepMinutes,
    preferences = {},
    minimumScore,
    maxSuggestions,
    participantEmails,
    resourceId,
    attendeeCount,
    autoAllocateResource,
    resourceType,
  } = req.body;

  try {
    if (resourceId && autoAllocateResource) {
      return res.status(400).json({
        success: false,
        message: "Cannot specify both resourceId and autoAllocateResource",
      });
    }

    if (autoAllocateResource) {
      if (
        resourceType !== undefined &&
        resourceType !== null &&
        resourceType !== ""
      ) {
        if (resourceType !== "room" && resourceType !== "equipment") {
          return res.status(400).json({
            success: false,
            message: "resourceType must be either 'room' or 'equipment'",
          });
        }
      }

      if (
        attendeeCount !== undefined &&
        attendeeCount !== null &&
        attendeeCount !== ""
      ) {
        const count = Number(attendeeCount);
        if (!Number.isInteger(count) || count < 1) {
          return res.status(400).json({
            success: false,
            message: "Attendee count must be a positive integer",
          });
        }
      }
    }

    const { participants, userIds } = await resolveParticipants({
      organizerId: req.user.id,
      organizerFallback: {
        _id: req.user.id,
        name: req.user.name || "Organizer",
        email: req.user.email || "",
        timezone: "UTC",
      },
      participantEmails,
    });

    const organizer = participants[0];
    const authoritativeTimezone = normalizeTimezone(organizer?.timezone, "UTC");

    const mergedPreferences = {
      ...preferences,
      timezone: preferences.timezone
        ? normalizeTimezone(preferences.timezone, authoritativeTimezone)
        : authoritativeTimezone,
    };

    let safeResource = null;
    let resourceBusyRanges = [];

    if (resourceId) {
      const validatedResource = await validateResourceForBooking({
        resourceId,
        attendeeCount,
      });
      safeResource = formatSafeResourceSummary(validatedResource);
      resourceBusyRanges = await findResourceBusyRanges({
        resourceId,
        windowStart,
        windowEnd,
      });
    }

    const result = await findSuggestionsWithRelaxation({
      ownerIds: userIds,
      windowStart,
      windowEnd,
      durationMinutes,
      slotStepMinutes,
      preferences: mergedPreferences,
      minimumScore,
      maxSuggestions,
      additionalBusyRanges: resourceBusyRanges,
      autoAllocateResource: Boolean(autoAllocateResource),
      resourceType,
      attendeeCount,
    });

    const serializedSuggestions = result.suggestions.map((slot) => {
      const item = {
        startAt:
          slot.startAt instanceof Date ? slot.startAt.toISOString() : slot.startAt,
        endAt:
          slot.endAt instanceof Date ? slot.endAt.toISOString() : slot.endAt,
        score: typeof slot.score === "number" ? slot.score : 50,
        reasons: Array.isArray(slot.reasons) ? slot.reasons : [],
        relaxedConstraints: Array.isArray(slot.relaxedConstraints)
          ? slot.relaxedConstraints
          : [],
      };
      if (slot.allocatedResource) {
        item.allocatedResource = slot.allocatedResource;
        item.allocationReason = slot.allocationReason;
      }
      return item;
    });

    const responsePayload = {
      success: true,
      participants,
      suggestions: serializedSuggestions,
      relaxed: result.relaxed,
      relaxationLevel: result.relaxationLevel,
      relaxationSteps: result.relaxationSteps,
    };

    if (safeResource) {
      responsePayload.resource = safeResource;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
    });
  }
}
