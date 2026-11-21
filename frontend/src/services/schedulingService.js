import apiRequest from "./apiClient";

export async function checkEventConflicts({ startAt, endAt, excludeEventId }) {
  const body = { startAt, endAt };

  if (excludeEventId) {
    body.excludeEventId = excludeEventId;
  }

  const response = await apiRequest("/api/scheduling/conflicts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    hasConflict: response.hasConflict,
    conflicts: response.conflicts,
  };
}

export async function findAvailableSlots({
  windowStart,
  windowEnd,
  durationMinutes,
  slotStepMinutes,
  preferences,
  participantEmails,
  resourceId,
  attendeeCount,
  autoAllocateResource,
  resourceType,
}) {
  const body = {
    windowStart,
    windowEnd,
    durationMinutes,
  };

  if (
    slotStepMinutes !== undefined &&
    slotStepMinutes !== null &&
    slotStepMinutes !== ""
  ) {
    body.slotStepMinutes = slotStepMinutes;
  }

  if (preferences && typeof preferences === "object") {
    body.preferences = preferences;
  }

  if (Array.isArray(participantEmails) && participantEmails.length > 0) {
    body.participantEmails = participantEmails;
  }

  if (resourceId) {
    body.resourceId = resourceId;
  }

  if (
    attendeeCount !== undefined &&
    attendeeCount !== null &&
    attendeeCount !== ""
  ) {
    body.attendeeCount = Number(attendeeCount);
  }

  if (autoAllocateResource) {
    body.autoAllocateResource = true;
  }

  if (resourceType) {
    body.resourceType = resourceType;
  }

  const response = await apiRequest("/api/scheduling/available-slots", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    slots: response.slots || [],
    participants: response.participants || [],
    resource: response.resource || null,
  };
}

export async function findSmartSuggestions({
  windowStart,
  windowEnd,
  durationMinutes,
  slotStepMinutes,
  preferences,
  minimumScore,
  maxSuggestions,
  participantEmails,
  resourceId,
  attendeeCount,
  autoAllocateResource,
  resourceType,
}) {
  const body = {
    windowStart,
    windowEnd,
    durationMinutes,
  };

  if (
    slotStepMinutes !== undefined &&
    slotStepMinutes !== null &&
    slotStepMinutes !== ""
  ) {
    body.slotStepMinutes = slotStepMinutes;
  }

  if (preferences && typeof preferences === "object") {
    body.preferences = preferences;
  }

  if (
    minimumScore !== undefined &&
    minimumScore !== null &&
    minimumScore !== ""
  ) {
    body.minimumScore = Number(minimumScore);
  }

  if (
    maxSuggestions !== undefined &&
    maxSuggestions !== null &&
    maxSuggestions !== ""
  ) {
    body.maxSuggestions = Number(maxSuggestions);
  }

  if (Array.isArray(participantEmails) && participantEmails.length > 0) {
    body.participantEmails = participantEmails;
  }

  if (resourceId) {
    body.resourceId = resourceId;
  }

  if (
    attendeeCount !== undefined &&
    attendeeCount !== null &&
    attendeeCount !== ""
  ) {
    body.attendeeCount = Number(attendeeCount);
  }

  if (autoAllocateResource) {
    body.autoAllocateResource = true;
  }

  if (resourceType) {
    body.resourceType = resourceType;
  }

  const response = await apiRequest("/api/scheduling/suggestions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    suggestions: response.suggestions || [],
    relaxed: Boolean(response.relaxed),
    relaxationLevel: response.relaxationLevel ?? 0,
    relaxationSteps: response.relaxationSteps || [],
    participants: response.participants || [],
    resource: response.resource || null,
  };
}
