import test from "node:test";
import assert from "node:assert/strict";
import { getMeetingChanges } from "../src/services/schedulingEvents.js";

const event = {
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  location: "Room 4",
  resource: "res-1",
};

const unchanged = {
  previousStartAt: new Date("2026-12-01T10:00:00.000Z"),
  previousEndAt: new Date("2026-12-01T11:00:00.000Z"),
  previousLocation: "Room 4",
  previousResourceId: "res-1",
};

test("no attendee-relevant change when only other fields were edited", () => {
  assert.deepEqual(getMeetingChanges(event, unchanged), []);
});

test("detects time, location and resource changes", () => {
  assert.deepEqual(
    getMeetingChanges(event, { ...unchanged, previousEndAt: new Date("2026-12-01T10:30:00.000Z") }),
    ["time"],
  );
  assert.deepEqual(getMeetingChanges(event, { ...unchanged, previousLocation: "" }), ["location"]);
  assert.deepEqual(getMeetingChanges(event, { ...unchanged, previousResourceId: null }), ["resource"]);
});

test("missing previous values are not treated as changes", () => {
  assert.deepEqual(getMeetingChanges(event, {}), []);
});
