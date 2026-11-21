import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSlotSearchInput,
  buildBusyRanges,
  slotOverlapsBusyRange,
  isSlotAvailable,
  findAvailableSlots,
} from "../src/services/scheduling/availableSlotService.js";

function makeEvent(overrides = {}) {
  const base = {
    _id: "event-1",
    id: "event-1",
    owner: "owner-123",
    title: "Busy Meeting",
    ...overrides,
  };

  base.startAt = new Date(overrides.startAt || "2026-08-25T10:00:00.000Z");
  base.endAt = new Date(overrides.endAt || "2026-08-25T11:00:00.000Z");
  return base;
}

function makeFakeEventModel(storedEvents = [], capturedQueries = []) {
  return {
    find(query) {
      capturedQueries.push(query);
      const { owner, startAt: startQuery, endAt: endQuery } = query;
      const windowEnd = startQuery.$lt;
      const windowStart = endQuery.$gt;

      const results = storedEvents.filter((ev) => {
        if (ev.owner !== owner) return false;
        return ev.startAt < windowEnd && ev.endAt > windowStart;
      });

      return {
        sort() {
          return [...results].sort((a, b) => a.startAt - b.startAt);
        },
      };
    },
  };
}

test("normalizeSlotSearchInput returns normalized dates and positive numbers", () => {
  const result = normalizeSlotSearchInput({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 30,
  });

  assert.ok(result.windowStart instanceof Date);
  assert.ok(result.windowEnd instanceof Date);
  assert.equal(result.windowStart.toISOString(), "2026-08-25T09:00:00.000Z");
  assert.equal(result.windowEnd.toISOString(), "2026-08-25T17:00:00.000Z");
  assert.equal(result.durationMinutes, 60);
  assert.equal(result.slotStepMinutes, 30);
});

test("normalizeSlotSearchInput defaults slotStepMinutes to 30", () => {
  const result = normalizeSlotSearchInput({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 45,
  });

  assert.equal(result.slotStepMinutes, 30);
});

test("normalizeSlotSearchInput validates missing windowStart", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowStart is required/,
  );
});

test("normalizeSlotSearchInput validates missing windowEnd", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowEnd is required/,
  );
});

test("normalizeSlotSearchInput validates invalid date for windowStart", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "invalid-date",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowStart must be a valid date/,
  );
});

test("normalizeSlotSearchInput validates invalid date for windowEnd", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "not-a-date",
        durationMinutes: 60,
      }),
    /windowEnd must be a valid date/,
  );
});

test("normalizeSlotSearchInput validates windowEnd after windowStart", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T10:00:00.000Z",
        windowEnd: "2026-08-25T09:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowEnd must be after windowStart/,
  );

  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T10:00:00.000Z",
        windowEnd: "2026-08-25T10:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowEnd must be after windowStart/,
  );
});

test("normalizeSlotSearchInput validates missing durationMinutes", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
      }),
    /durationMinutes is required/,
  );
});

test("normalizeSlotSearchInput validates durationMinutes must be positive", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 0,
      }),
    /durationMinutes must be positive/,
  );

  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: -15,
      }),
    /durationMinutes must be positive/,
  );

  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: "abc",
      }),
    /durationMinutes must be positive/,
  );
});

test("normalizeSlotSearchInput validates slotStepMinutes must be positive if provided", () => {
  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
        slotStepMinutes: 0,
      }),
    /slotStepMinutes must be positive/,
  );

  assert.throws(
    () =>
      normalizeSlotSearchInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
        slotStepMinutes: -10,
      }),
    /slotStepMinutes must be positive/,
  );
});

test("buildBusyRanges converts event array to Date range objects", () => {
  const events = [
    { startAt: "2026-08-25T10:00:00.000Z", endAt: "2026-08-25T11:00:00.000Z" },
    { startAt: new Date("2026-08-25T14:00:00.000Z"), endAt: new Date("2026-08-25T15:00:00.000Z") },
  ];

  const ranges = buildBusyRanges(events);
  assert.equal(ranges.length, 2);
  assert.ok(ranges[0].start instanceof Date);
  assert.ok(ranges[0].end instanceof Date);
  assert.equal(ranges[0].start.toISOString(), "2026-08-25T10:00:00.000Z");
  assert.equal(ranges[1].end.toISOString(), "2026-08-25T15:00:00.000Z");
});

test("slotOverlapsBusyRange detects overlaps correctly and allows adjacent slots", () => {
  const busy = {
    start: new Date("2026-08-25T10:00:00.000Z"),
    end: new Date("2026-08-25T11:00:00.000Z"),
  };

  assert.equal(
    slotOverlapsBusyRange(
      { start: new Date("2026-08-25T09:00:00.000Z"), end: new Date("2026-08-25T10:00:00.000Z") },
      busy,
    ),
    false,
  );

  assert.equal(
    slotOverlapsBusyRange(
      { start: new Date("2026-08-25T11:00:00.000Z"), end: new Date("2026-08-25T12:00:00.000Z") },
      busy,
    ),
    false,
  );

  assert.equal(
    slotOverlapsBusyRange(
      { start: new Date("2026-08-25T09:30:00.000Z"), end: new Date("2026-08-25T10:30:00.000Z") },
      busy,
    ),
    true,
  );

  assert.equal(
    slotOverlapsBusyRange(
      { start: new Date("2026-08-25T10:15:00.000Z"), end: new Date("2026-08-25T10:45:00.000Z") },
      busy,
    ),
    true,
  );

  assert.equal(
    slotOverlapsBusyRange(
      { start: new Date("2026-08-25T09:00:00.000Z"), end: new Date("2026-08-25T12:00:00.000Z") },
      busy,
    ),
    true,
  );
});

test("isSlotAvailable returns true when slot overlaps no busy ranges", () => {
  const busyRanges = [
    { start: new Date("2026-08-25T10:00:00.000Z"), end: new Date("2026-08-25T11:00:00.000Z") },
    { start: new Date("2026-08-25T13:00:00.000Z"), end: new Date("2026-08-25T14:00:00.000Z") },
  ];

  assert.equal(
    isSlotAvailable(
      { start: new Date("2026-08-25T11:00:00.000Z"), end: new Date("2026-08-25T12:00:00.000Z") },
      busyRanges,
    ),
    true,
  );

  assert.equal(
    isSlotAvailable(
      { start: new Date("2026-08-25T10:30:00.000Z"), end: new Date("2026-08-25T11:30:00.000Z") },
      busyRanges,
    ),
    false,
  );
});

test("findAvailableSlots returns full-window slots when no events exist", async () => {
  const EventModel = makeFakeEventModel([]);

  const slots = await findAvailableSlots({
    ownerId: "owner-123",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T11:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 30,
    EventModel,
  });

  assert.equal(slots.length, 3);
  assert.equal(slots[0].startAt.toISOString(), "2026-08-25T09:00:00.000Z");
  assert.equal(slots[0].endAt.toISOString(), "2026-08-25T10:00:00.000Z");
  assert.equal(slots[1].startAt.toISOString(), "2026-08-25T09:30:00.000Z");
  assert.equal(slots[1].endAt.toISOString(), "2026-08-25T10:30:00.000Z");
  assert.equal(slots[2].startAt.toISOString(), "2026-08-25T10:00:00.000Z");
});

test("findAvailableSlots excludes slots overlapping one busy event", async () => {
  const existing = makeEvent({
    owner: "owner-123",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
  });

  const EventModel = makeFakeEventModel([existing]);

  const slots = await findAvailableSlots({
    ownerId: "owner-123",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T13:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 30,
    EventModel,
  });

  const slotStrings = slots.map(
    (s) => `${s.startAt.toISOString()} -> ${s.endAt.toISOString()}`,
  );

  assert.deepEqual(slotStrings, [
    "2026-08-25T09:00:00.000Z -> 2026-08-25T10:00:00.000Z",
    "2026-08-25T11:00:00.000Z -> 2026-08-25T12:00:00.000Z",
    "2026-08-25T11:30:00.000Z -> 2026-08-25T12:30:00.000Z",
    "2026-08-25T12:00:00.000Z -> 2026-08-25T13:00:00.000Z",
  ]);
});

test("findAvailableSlots allows slots ending exactly at busy event start", async () => {
  const existing = makeEvent({
    owner: "owner-123",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
  });

  const EventModel = makeFakeEventModel([existing]);

  const slots = await findAvailableSlots({
    ownerId: "owner-123",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T10:00:00.000Z",
    durationMinutes: 60,
    EventModel,
  });

  assert.equal(slots.length, 1);
  assert.equal(slots[0].startAt.toISOString(), "2026-08-25T09:00:00.000Z");
  assert.equal(slots[0].endAt.toISOString(), "2026-08-25T10:00:00.000Z");
});

test("findAvailableSlots allows slots starting exactly at busy event end", async () => {
  const existing = makeEvent({
    owner: "owner-123",
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
  });

  const EventModel = makeFakeEventModel([existing]);

  const slots = await findAvailableSlots({
    ownerId: "owner-123",
    windowStart: "2026-08-25T11:00:00.000Z",
    windowEnd: "2026-08-25T12:00:00.000Z",
    durationMinutes: 60,
    EventModel,
  });

  assert.equal(slots.length, 1);
  assert.equal(slots[0].startAt.toISOString(), "2026-08-25T11:00:00.000Z");
  assert.equal(slots[0].endAt.toISOString(), "2026-08-25T12:00:00.000Z");
});

test("findAvailableSlots returns empty when duration is longer than window", async () => {
  const EventModel = makeFakeEventModel([]);

  const slots = await findAvailableSlots({
    ownerId: "owner-123",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T10:00:00.000Z",
    durationMinutes: 90,
    EventModel,
  });

  assert.deepEqual(slots, []);
});

test("findAvailableSlots supports custom slotStepMinutes", async () => {
  const EventModel = makeFakeEventModel([]);

  const slots = await findAvailableSlots({
    ownerId: "owner-123",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T10:00:00.000Z",
    durationMinutes: 15,
    slotStepMinutes: 15,
    EventModel,
  });

  assert.equal(slots.length, 4);
  assert.equal(slots[0].startAt.toISOString(), "2026-08-25T09:00:00.000Z");
  assert.equal(slots[0].endAt.toISOString(), "2026-08-25T09:15:00.000Z");
  assert.equal(slots[3].startAt.toISOString(), "2026-08-25T09:45:00.000Z");
  assert.equal(slots[3].endAt.toISOString(), "2026-08-25T10:00:00.000Z");
});

test("findAvailableSlots fetch query is scoped by owner and overlap window", async () => {
  const capturedQueries = [];
  const EventModel = makeFakeEventModel([], capturedQueries);

  await findAvailableSlots({
    ownerId: "owner-abc",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 60,
    EventModel,
  });

  assert.equal(capturedQueries.length, 1);
  const query = capturedQueries[0];
  assert.equal(query.owner, "owner-abc");
  assert.equal(query.startAt.$lt.toISOString(), "2026-08-25T17:00:00.000Z");
  assert.equal(query.endAt.$gt.toISOString(), "2026-08-25T09:00:00.000Z");
});
