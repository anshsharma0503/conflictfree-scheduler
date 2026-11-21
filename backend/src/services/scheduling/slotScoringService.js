import { MinHeap } from "./minHeapService.js";
import { getTimePartsInTimezone, normalizeTimezone } from "../timezoneService.js";

export function normalizeSlotPreferences(preferences = {}) {
  if (!preferences || typeof preferences !== "object") {
    return {
      preferredStartHour: null,
      preferredEndHour: null,
      avoidEarlyMorning: false,
      avoidLateDay: false,
      earliestSlotBonus: false,
      timezone: "UTC",
    };
  }

  const preferredStart =
    preferences.preferredStartHour !== undefined &&
    preferences.preferredStartHour !== null &&
    preferences.preferredStartHour !== ""
      ? Number(preferences.preferredStartHour)
      : null;

  const preferredEnd =
    preferences.preferredEndHour !== undefined &&
    preferences.preferredEndHour !== null &&
    preferences.preferredEndHour !== ""
      ? Number(preferences.preferredEndHour)
      : null;

  return {
    preferredStartHour:
      Number.isInteger(preferredStart) &&
      preferredStart >= 0 &&
      preferredStart <= 23
        ? preferredStart
        : null,
    preferredEndHour:
      Number.isInteger(preferredEnd) &&
      preferredEnd >= 0 &&
      preferredEnd <= 23
        ? preferredEnd
        : null,
    avoidEarlyMorning: Boolean(preferences.avoidEarlyMorning),
    avoidLateDay: Boolean(preferences.avoidLateDay),
    earliestSlotBonus: Boolean(preferences.earliestSlotBonus),
    timezone: normalizeTimezone(preferences.timezone, "UTC"),
  };
}

export function scoreSlot(slot, preferences = {}, slotIndex = 0) {
  const normalized = normalizeSlotPreferences(preferences);
  let score = 50;
  const reasons = [];

  const start =
    slot.startAt instanceof Date ? slot.startAt : new Date(slot.startAt);
  const end = slot.endAt instanceof Date ? slot.endAt : new Date(slot.endAt);

  const startParts = getTimePartsInTimezone(start, normalized.timezone);
  const endParts = getTimePartsInTimezone(end, normalized.timezone);

  const startHour = startParts.hour;
  const endHour = endParts.hour;
  const endMinutes = endParts.minute;

  if (
    normalized.preferredStartHour !== null &&
    normalized.preferredEndHour !== null
  ) {
    if (
      startHour >= normalized.preferredStartHour &&
      startHour < normalized.preferredEndHour
    ) {
      score += 30;
      reasons.push("Inside preferred time window");
    }
  }

  if (normalized.avoidEarlyMorning) {
    if (startHour < 10) {
      score -= 15;
      reasons.push("Early morning penalty");
    } else {
      score += 5;
      reasons.push("Avoids early morning");
    }
  }

  if (normalized.avoidLateDay) {
    const isLateDay = endHour > 17 || (endHour === 17 && endMinutes > 0);

    if (isLateDay) {
      score -= 10;
      reasons.push("Late day penalty");
    } else {
      score += 5;
      reasons.push("Avoids late day");
    }
  }

  if (normalized.earliestSlotBonus) {
    const bonus = Math.max(0, 10 - slotIndex * 2);
    if (bonus > 0) {
      score += bonus;
      reasons.push("Earliest slot bonus");
    }
  }

  const clampedScore = Math.max(0, Math.min(100, score));

  return {
    ...slot,
    score: clampedScore,
    reasons,
  };
}

export function rankSlots(slots = [], preferences = {}) {
  const normalizedPrefs = normalizeSlotPreferences(preferences);

  const scoredSlots = slots.map((slot, index) =>
    scoreSlot(slot, normalizedPrefs, index),
  );

  const heap = new MinHeap((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const aTime =
      a.startAt instanceof Date ? a.startAt.getTime() : new Date(a.startAt).getTime();
    const bTime =
      b.startAt instanceof Date ? b.startAt.getTime() : new Date(b.startAt).getTime();

    return aTime - bTime;
  });

  for (const item of scoredSlots) {
    heap.push(item);
  }

  const ranked = [];
  while (heap.size() > 0) {
    ranked.push(heap.pop());
  }

  return ranked;
}