import { describe, expect, it } from "vitest";
import {
  formatEventTime,
  isValidTimezone,
  normalizeTimezone,
  toDateTimeLocalValue,
  toIsoDate,
} from "./timezone";

describe("timezone utils", () => {
  it("isValidTimezone validates IANA timezone strings", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Invalid/Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
  });

  it("normalizeTimezone falls back to default on invalid timezone", () => {
    expect(normalizeTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(normalizeTimezone("invalid", "UTC")).toBe("UTC");
    expect(normalizeTimezone(null, "UTC")).toBe("UTC");
  });

  it("toDateTimeLocalValue formats UTC ISO instant into local datetime-local format", () => {
    const utcIso = "2026-09-26T05:00:00.000Z";

    expect(toDateTimeLocalValue(utcIso, "Asia/Kolkata")).toBe("2026-09-26T10:30");
    expect(toDateTimeLocalValue(utcIso, "America/New_York")).toBe("2026-09-26T01:00");
    expect(toDateTimeLocalValue(utcIso, "UTC")).toBe("2026-09-26T05:00");
  });

  it("toIsoDate converts local datetime-local string to UTC ISO instant", () => {
    expect(toIsoDate("2026-09-26T10:30", "Asia/Kolkata")).toBe("2026-09-26T05:00:00.000Z");
    expect(toIsoDate("2026-09-26T10:30", "America/New_York")).toBe("2026-09-26T14:30:00.000Z");
    expect(toIsoDate("2026-09-26T10:30", "UTC")).toBe("2026-09-26T10:30:00.000Z");
  });

  it("formatEventTime formats ISO date in user timezone", () => {
    const utcIso = "2026-09-26T05:00:00.000Z";

    expect(formatEventTime(utcIso, "Asia/Kolkata")).toBe("Sep 26, 2026, 10:30 AM");
    expect(formatEventTime(utcIso, "America/New_York")).toBe("Sep 26, 2026, 1:00 AM");
    expect(formatEventTime(utcIso, "UTC")).toBe("Sep 26, 2026, 5:00 AM");
  });
});
