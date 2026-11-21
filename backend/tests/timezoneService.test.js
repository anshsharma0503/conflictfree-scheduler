import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidTimezone,
  normalizeTimezone,
  getTimePartsInTimezone,
  getHourInTimezone,
  getMinuteInTimezone,
  localDateTimeToUtc,
  utcToLocalDateTime,
  formatDateInTimezone,
} from "../src/services/timezoneService.js";

test("isValidTimezone validates IANA timezone identifiers", () => {
  assert.equal(isValidTimezone("Asia/Kolkata"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("Europe/London"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Invalid/Timezone"), false);
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone(null), false);
});

test("normalizeTimezone falls back to UTC on invalid timezones", () => {
  assert.equal(normalizeTimezone("Asia/Kolkata"), "Asia/Kolkata");
  assert.equal(normalizeTimezone(" invalid "), "UTC");
  assert.equal(normalizeTimezone(null), "UTC");
});

test("localDateTimeToUtc converts Asia/Kolkata 10:30 to 05:00 UTC", () => {
  const utcDate = localDateTimeToUtc("2026-09-26T10:30", "Asia/Kolkata");
  assert.equal(utcDate.toISOString(), "2026-09-26T05:00:00.000Z");
});

test("localDateTimeToUtc converts America/New_York 10:30 EDT to 14:30 UTC", () => {
  const utcDate = localDateTimeToUtc("2026-09-26T10:30", "America/New_York");
  assert.equal(utcDate.toISOString(), "2026-09-26T14:30:00.000Z");
});

test("utcToLocalDateTime converts 05:00 UTC to 10:30 in Asia/Kolkata", () => {
  const localStr = utcToLocalDateTime("2026-09-26T05:00:00.000Z", "Asia/Kolkata");
  assert.equal(localStr, "2026-09-26T10:30");
});

test("getHourInTimezone and getMinuteInTimezone return wall-clock values in timezone", () => {
  const instant = new Date("2026-09-26T05:00:00.000Z");

  assert.equal(getHourInTimezone(instant, "Asia/Kolkata"), 10);
  assert.equal(getMinuteInTimezone(instant, "Asia/Kolkata"), 30);

  assert.equal(getHourInTimezone(instant, "America/New_York"), 1);
  assert.equal(getMinuteInTimezone(instant, "America/New_York"), 0);

  assert.equal(getHourInTimezone(instant, "Europe/London"), 6);
  assert.equal(getMinuteInTimezone(instant, "Europe/London"), 0);
});

test("formatDateInTimezone formats date in specified timezone", () => {
  const instant = new Date("2026-09-26T05:00:00.000Z");
  const formatted = formatDateInTimezone(instant, "Asia/Kolkata");
  assert.match(formatted, /Sep 26, 2026, 10:30 AM/);
});
