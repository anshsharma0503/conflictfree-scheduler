// Turns a free-text request into a validated scheduling draft (Phase N).
//
// Gemini only proposes fields. Everything that reaches the client is
// re-validated here, and people are resolved against registered users on
// the server with the existing participant Trie (Decision 47). The model
// never sees other users' names or emails, and it cannot add a participant
// that does not match a real account.
import { localDateTimeToUtc, utcToLocalDateTime } from "../timezoneService.js";
import { AssistantError } from "./geminiClient.js";
import {
  MAX_REQUEST_LENGTH,
  SCHEDULING_REQUEST_SCHEMA,
  buildSystemInstruction,
} from "./schedulingPrompt.js";

const MINUTE = 60_000;
const DEFAULT_DURATION_MINUTES = 30;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 8 * 60;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 31;
const MAX_PARTICIPANTS = 10;
const MAX_ATTENDEES = 500;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function validateRequestText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw httpError("Describe the meeting you want to schedule.", 400);
  }

  const trimmed = text.trim();

  if (trimmed.length < 3) {
    throw httpError("Describe the meeting you want to schedule.", 400);
  }

  if (trimmed.length > MAX_REQUEST_LENGTH) {
    throw httpError(`Keep the description under ${MAX_REQUEST_LENGTH} characters.`, 400);
  }

  return trimmed;
}

function ceilToQuarterHour(date) {
  const quarter = 15 * MINUTE;
  return new Date(Math.ceil(date.getTime() / quarter) * quarter);
}

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function toInteger(value) {
  return Number.isInteger(value) ? value : Number.isFinite(value) ? Math.round(value) : null;
}

function parseLocal(value, timezone) {
  const text = cleanString(value, 40);

  if (!text) {
    return null;
  }

  // Accept local wall-clock (asked for) and full ISO with an offset (some
  // models add one anyway); anything else is rejected.
  if (!LOCAL_DATE_TIME.test(text) && Number.isNaN(Date.parse(text))) {
    return null;
  }

  try {
    const date = localDateTimeToUtc(text, timezone);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Normalizes the model's raw answer into a draft. Pure apart from the
 * injected participant resolver.
 */
export async function normalizeSchedulingDraft({ raw, now, timezone, resolveParticipant }) {
  if (!raw || typeof raw !== "object") {
    throw new AssistantError("The assistant returned an unreadable answer.", 502, "bad_json");
  }

  if (raw.intent !== "schedule_meeting") {
    throw httpError(
      "That doesn't look like a scheduling request. Try something like “30 minutes with Priya tomorrow afternoon”.",
      422,
    );
  }

  const assumptions = [];

  // Duration.
  let durationMinutes = toInteger(raw.durationMinutes);
  if (!durationMinutes || durationMinutes <= 0) {
    durationMinutes = DEFAULT_DURATION_MINUTES;
    assumptions.push(`No length given, so using ${DEFAULT_DURATION_MINUTES} minutes.`);
  } else if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    const clamped = Math.min(Math.max(durationMinutes, MIN_DURATION_MINUTES), MAX_DURATION_MINUTES);
    assumptions.push(`A ${durationMinutes}-minute meeting is outside 5 minutes–8 hours, so using ${clamped} minutes.`);
    durationMinutes = clamped;
  }

  // Window.
  const earliest = ceilToQuarterHour(now);
  let windowStart = parseLocal(raw.windowStart, timezone);
  let windowEnd = parseLocal(raw.windowEnd, timezone);

  if (!windowStart || !windowEnd || windowEnd <= windowStart) {
    if (cleanString(raw.windowStart, 40) || cleanString(raw.windowEnd, 40)) {
      assumptions.push("The time range was unclear, so searching the next 7 days instead.");
    } else {
      assumptions.push("No time given, so searching the next 7 days.");
    }
    windowStart = earliest;
    windowEnd = new Date(earliest.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * MINUTE);
  }

  if (windowEnd <= now) {
    throw httpError("That time is already in the past. Try a time from now on.", 422);
  }

  if (windowStart < earliest) {
    windowStart = earliest;
    assumptions.push("Part of that time has already passed, so searching from now.");
  }

  const maxEnd = new Date(windowStart.getTime() + MAX_WINDOW_DAYS * 24 * 60 * MINUTE);
  if (windowEnd > maxEnd) {
    windowEnd = maxEnd;
    assumptions.push(`Searching at most ${MAX_WINDOW_DAYS} days ahead.`);
  }

  if (windowEnd.getTime() - windowStart.getTime() < durationMinutes * MINUTE) {
    windowEnd = new Date(windowStart.getTime() + durationMinutes * MINUTE);
    assumptions.push("The time range was shorter than the meeting, so it was extended.");
  }

  // Preferences: only well-formed values survive.
  const preferences = {};
  const startHour = toInteger(raw.preferredStartHour);
  const endHour = toInteger(raw.preferredEndHour);
  if (startHour !== null && startHour >= 0 && startHour <= 23) {
    preferences.preferredStartHour = startHour;
  }
  if (endHour !== null && endHour >= 1 && endHour <= 24) {
    preferences.preferredEndHour = endHour;
  }
  if (
    preferences.preferredStartHour !== undefined &&
    preferences.preferredEndHour !== undefined &&
    preferences.preferredEndHour <= preferences.preferredStartHour
  ) {
    delete preferences.preferredStartHour;
    delete preferences.preferredEndHour;
  }
  if (raw.avoidEarlyMorning === true) preferences.avoidEarlyMorning = true;
  if (raw.avoidLateDay === true) preferences.avoidLateDay = true;

  // Room or equipment.
  const resourceType = ["room", "equipment"].includes(raw.resourceType) ? raw.resourceType : null;
  const attendees = toInteger(raw.attendeeCount);
  const attendeeCount = attendees && attendees > 0 && attendees <= MAX_ATTENDEES ? attendees : null;

  // People: resolved against registered users, never taken from the model.
  const queries = Array.from(
    new Set(
      (Array.isArray(raw.participants) ? raw.participants : [])
        .map((value) => cleanString(value, 100))
        .filter((value) => value.length >= 2),
    ),
  );
  if (queries.length > MAX_PARTICIPANTS) {
    assumptions.push(`Only the first ${MAX_PARTICIPANTS} people were looked up.`);
  }

  const participants = [];
  for (const query of queries.slice(0, MAX_PARTICIPANTS)) {
    const matches = await resolveParticipant(query);
    participants.push({
      query,
      status: matches.length === 1 ? "matched" : matches.length > 1 ? "ambiguous" : "not_found",
      matches: matches.slice(0, 5),
    });
  }

  const names = participants
    .filter((p) => p.status === "matched")
    .map((p) => p.matches[0].name.split(" ")[0]);
  const title =
    cleanString(raw.title, 120) || (names.length ? `Meeting with ${names.join(", ")}` : "Meeting");

  return {
    title,
    durationMinutes,
    timezone,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowStartLocal: utcToLocalDateTime(windowStart, timezone),
    windowEndLocal: utcToLocalDateTime(windowEnd, timezone),
    participants,
    preferences,
    resource: { type: resourceType, attendeeCount },
    assumptions,
    clarification: cleanString(raw.clarification, 200),
  };
}

/**
 * Full pipeline: validate text → ask Gemini → normalize. `client` is a
 * Gemini client from createGeminiClient (or a test double).
 */
export async function parseSchedulingRequest({
  text,
  timezone,
  now = new Date(),
  client,
  resolveParticipant,
}) {
  const userText = validateRequestText(text);

  const { data, model } = await client.generateJson({
    systemInstruction: buildSystemInstruction({ now, timezone }),
    userText,
    responseJsonSchema: SCHEDULING_REQUEST_SCHEMA,
  });

  const draft = await normalizeSchedulingDraft({ raw: data, now, timezone, resolveParticipant });

  return { draft, model };
}
