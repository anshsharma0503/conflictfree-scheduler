import { describe, expect, test } from "vitest";
import {
  addDaysToKey,
  buildWeek,
  findUpcomingConflicts,
  getEventKind,
  getWeekStartKey,
  getZonedParts,
  layoutDayItems,
} from "./calendarLayout";

const user = { id: "user-1", email: "me@example.com" };

describe("date keys", () => {
  test("getWeekStartKey returns the Monday of the week", () => {
    expect(getWeekStartKey("2026-11-17")).toBe("2026-11-16");
    expect(getWeekStartKey("2026-11-16")).toBe("2026-11-16");
    expect(getWeekStartKey("2026-11-22")).toBe("2026-11-16");
  });

  test("addDaysToKey crosses month boundaries", () => {
    expect(addDaysToKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("getZonedParts converts to the requested timezone", () => {
    expect(getZonedParts("2026-11-17T09:00:00.000Z", "Asia/Kolkata")).toEqual({
      dateKey: "2026-11-17",
      minutes: 14 * 60 + 30,
    });
    expect(getZonedParts("not-a-date", "UTC")).toBeNull();
  });
});

describe("layoutDayItems", () => {
  test("keeps non-overlapping items in one column without conflicts", () => {
    const result = layoutDayItems([
      { id: "a", startMin: 540, endMin: 600 },
      { id: "b", startMin: 600, endMin: 660 },
    ]);

    expect(result.map((item) => [item.id, item.column, item.columns, item.isConflict])).toEqual([
      ["a", 0, 1, false],
      ["b", 0, 1, false],
    ]);
  });

  test("splits overlapping items into columns and flags them", () => {
    const result = layoutDayItems([
      { id: "a", startMin: 840, endMin: 900 },
      { id: "b", startMin: 870, endMin: 930 },
    ]);

    expect(result.map((item) => [item.id, item.column, item.columns, item.isConflict])).toEqual([
      ["a", 0, 2, true],
      ["b", 1, 2, true],
    ]);
  });
});

describe("buildWeek", () => {
  test("places events on the right day and skips cancelled ones", () => {
    const week = buildWeek(
      [
        { id: "1", title: "Sync", startAt: "2026-11-17T10:00:00.000Z", endAt: "2026-11-17T11:00:00.000Z" },
        {
          id: "2",
          title: "Gone",
          status: "cancelled",
          startAt: "2026-11-18T10:00:00.000Z",
          endAt: "2026-11-18T11:00:00.000Z",
        },
        { id: "3", title: "Next week", startAt: "2026-11-24T10:00:00.000Z", endAt: "2026-11-24T11:00:00.000Z" },
      ],
      { timezone: "UTC", weekStartKey: "2026-11-16", todayKey: "2026-11-17", user },
    );

    expect(week.days).toHaveLength(7);
    expect(week.days[1].isToday).toBe(true);
    expect(week.days[1].items.map((item) => item.title)).toEqual(["Sync"]);
    expect(week.days[2].items).toEqual([]);
    expect(week.startHour).toBe(8);
    expect(week.endHour).toBe(19);
  });

  test("expands the hour range for early events", () => {
    const week = buildWeek(
      [{ id: "1", title: "Early", startAt: "2026-11-17T06:30:00.000Z", endAt: "2026-11-17T07:00:00.000Z" }],
      { timezone: "UTC", weekStartKey: "2026-11-16", todayKey: "2026-11-17", user },
    );

    expect(week.startHour).toBe(6);
  });
});

describe("getEventKind", () => {
  test("classifies invitations, shared and personal events", () => {
    expect(
      getEventKind(
        { owner: "other", participants: [{ email: "me@example.com", status: "pending" }] },
        user,
      ),
    ).toBe("invite");
    expect(getEventKind({ owner: "user-1", participants: [{ email: "a@b.c" }] }, user)).toBe(
      "shared",
    );
    expect(getEventKind({ owner: "user-1", participants: [] }, user)).toBe("personal");
  });
});

describe("findUpcomingConflicts", () => {
  test("returns overlapping future events with the overlap window", () => {
    const now = new Date("2026-11-17T08:00:00.000Z");
    const conflicts = findUpcomingConflicts(
      [
        { id: "a", startAt: "2026-11-17T14:00:00.000Z", endAt: "2026-11-17T15:00:00.000Z" },
        { id: "b", startAt: "2026-11-17T14:30:00.000Z", endAt: "2026-11-17T15:30:00.000Z" },
        { id: "c", startAt: "2026-11-17T16:00:00.000Z", endAt: "2026-11-17T17:00:00.000Z" },
        { id: "old1", startAt: "2026-11-10T14:00:00.000Z", endAt: "2026-11-10T15:00:00.000Z" },
        { id: "old2", startAt: "2026-11-10T14:00:00.000Z", endAt: "2026-11-10T15:00:00.000Z" },
      ],
      now,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].first.id).toBe("a");
    expect(conflicts[0].second.id).toBe("b");
    expect(conflicts[0].overlapStart).toBe("2026-11-17T14:30:00.000Z");
    expect(conflicts[0].overlapEnd).toBe("2026-11-17T15:00:00.000Z");
  });
});
