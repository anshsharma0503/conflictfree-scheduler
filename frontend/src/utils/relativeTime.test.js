import { expect, test } from "vitest";
import { formatRelativeTime, formatReminderOption } from "./relativeTime";

const now = Date.parse("2026-12-01T12:00:00.000Z");

test("relative times", () => {
  expect(formatRelativeTime("2026-12-01T11:59:30.000Z", now)).toBe("Just now");
  expect(formatRelativeTime("2026-12-01T11:55:00.000Z", now)).toBe("5 min ago");
  expect(formatRelativeTime("2026-12-01T09:00:00.000Z", now)).toBe("3 h ago");
  expect(formatRelativeTime("2026-11-29T12:00:00.000Z", now)).toBe("2 d ago");
  expect(formatRelativeTime("2026-12-01T12:05:00.000Z", now)).toBe("Just now");
  expect(formatRelativeTime("not a date", now)).toBe("");
});

test("reminder option labels", () => {
  expect(formatReminderOption(0)).toBe("Off");
  expect(formatReminderOption(15)).toBe("15 minutes before");
  expect(formatReminderOption(60)).toBe("1 hour before");
  expect(formatReminderOption(1440)).toBe("1 day before");
});
