import { findAvailableSlots } from "./availableSlotService.js";

export function normalizeSuggestionInput({
  windowStart,
  windowEnd,
  durationMinutes,
  slotStepMinutes,
  preferences = {},
  minimumScore,
  maxSuggestions,
} = {}) {
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

  let minScore = 0;
  if (
    minimumScore !== undefined &&
    minimumScore !== null &&
    minimumScore !== ""
  ) {
    minScore = Number(minimumScore);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      throw new Error("minimumScore must be between 0 and 100");
    }
  }

  let maxCount = 3;
  if (
    maxSuggestions !== undefined &&
    maxSuggestions !== null &&
    maxSuggestions !== ""
  ) {
    maxCount = Number(maxSuggestions);
    if (!Number.isInteger(maxCount) || maxCount <= 0) {
      throw new Error("maxSuggestions must be a positive integer");
    }
  }

  return {
    windowStart: start,
    windowEnd: end,
    durationMinutes: duration,
    slotStepMinutes: step,
    preferences: preferences || {},
    minimumScore: minScore,
    maxSuggestions: maxCount,
  };
}

export function buildRelaxationPlans(preferences = {}) {
  return [
    {
      level: 0,
      label: "Strict constraints",
      relaxedConstraints: [],
    },
    {
      level: 1,
      label: "Relaxed preferred time window",
      relaxedConstraints: ["preferredTimeWindow"],
    },
    {
      level: 2,
      label: "Relaxed preferred time window and late day",
      relaxedConstraints: ["preferredTimeWindow", "avoidLateDay"],
    },
    {
      level: 3,
      label: "Relaxed preferred window, late day, and early morning",
      relaxedConstraints: [
        "preferredTimeWindow",
        "avoidLateDay",
        "avoidEarlyMorning",
      ],
    },
    {
      level: 4,
      label: "All soft constraints relaxed",
      relaxedConstraints: [
        "preferredTimeWindow",
        "avoidLateDay",
        "avoidEarlyMorning",
        "earliestSlotBonus",
      ],
    },
  ];
}

export function applyRelaxationPlan(preferences = {}, plan = {}) {
  const relaxed = { ...preferences };
  const level = plan.level ?? 0;

  if (level >= 1) {
    relaxed.preferredStartHour = null;
    relaxed.preferredEndHour = null;
  }

  if (level >= 2) {
    relaxed.avoidLateDay = false;
  }

  if (level >= 3) {
    relaxed.avoidEarlyMorning = false;
  }

  if (level >= 4) {
    relaxed.earliestSlotBonus = false;
  }

  return relaxed;
}

export async function findSuggestionsWithRelaxation({
  ownerId,
  ownerIds,
  windowStart,
  windowEnd,
  durationMinutes,
  slotStepMinutes,
  preferences = {},
  minimumScore = 0,
  maxSuggestions = 3,
  additionalBusyRanges = [],
  autoAllocateResource = false,
  resourceType,
  attendeeCount,
  EventModel,
  ResourceModel,
}) {
  const normalized = normalizeSuggestionInput({
    windowStart,
    windowEnd,
    durationMinutes,
    slotStepMinutes,
    preferences,
    minimumScore,
    maxSuggestions,
  });

  const plans = buildRelaxationPlans(normalized.preferences);
  const relaxationSteps = [];
  let lastLevelSlots = [];

  for (const plan of plans) {
    relaxationSteps.push(plan);
    const relaxedPrefs = applyRelaxationPlan(normalized.preferences, plan);

    const slots = await findAvailableSlots({
      ownerId,
      ownerIds,
      windowStart: normalized.windowStart,
      windowEnd: normalized.windowEnd,
      durationMinutes: normalized.durationMinutes,
      slotStepMinutes: normalized.slotStepMinutes,
      preferences: relaxedPrefs,
      additionalBusyRanges,
      autoAllocateResource,
      resourceType,
      attendeeCount,
      EventModel,
      ResourceModel,
    });

    lastLevelSlots = slots;

    let scoreDeduction = 0;
    if (plan.relaxedConstraints.includes("preferredTimeWindow")) {
      const hasPreferredWindow =
        normalized.preferences.preferredStartHour !== null &&
        normalized.preferences.preferredStartHour !== undefined &&
        normalized.preferences.preferredEndHour !== null &&
        normalized.preferences.preferredEndHour !== undefined;
      if (hasPreferredWindow) {
        scoreDeduction += 30;
      }
    }
    if (
      plan.relaxedConstraints.includes("avoidLateDay") &&
      normalized.preferences.avoidLateDay
    ) {
      scoreDeduction += 15;
    }
    if (
      plan.relaxedConstraints.includes("avoidEarlyMorning") &&
      normalized.preferences.avoidEarlyMorning
    ) {
      scoreDeduction += 15;
    }
    if (
      plan.relaxedConstraints.includes("earliestSlotBonus") &&
      normalized.preferences.earliestSlotBonus
    ) {
      scoreDeduction += 10;
    }

    const threshold = Math.max(0, normalized.minimumScore - scoreDeduction);

    const qualifying = slots.filter((slot) => {
      if (slot.score < threshold) {
        return false;
      }
      if (
        plan.level === 0 &&
        normalized.preferences.preferredStartHour !== null &&
        normalized.preferences.preferredStartHour !== undefined &&
        normalized.preferences.preferredEndHour !== null &&
        normalized.preferences.preferredEndHour !== undefined
      ) {
        return slot.reasons.includes("Inside preferred time window");
      }
      return true;
    });

    if (qualifying.length > 0) {
      return {
        suggestions: qualifying
          .slice(0, normalized.maxSuggestions)
          .map((slot) => ({
            ...slot,
            relaxedConstraints: plan.relaxedConstraints,
          })),
        relaxed: plan.level > 0,
        relaxationLevel: plan.level,
        relaxationSteps,
      };
    }
  }

  const fallbackPlan = plans[plans.length - 1];
  return {
    suggestions: lastLevelSlots
      .slice(0, normalized.maxSuggestions)
      .map((slot) => ({
        ...slot,
        relaxedConstraints: fallbackPlan.relaxedConstraints,
      })),
    relaxed: true,
    relaxationLevel: fallbackPlan.level,
    relaxationSteps,
  };
}
