import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSuggestionInput,
  buildRelaxationPlans,
  applyRelaxationPlan,
  findSuggestionsWithRelaxation,
} from "../src/services/scheduling/backtrackingSchedulingService.js";

function makeFakeEventModel(storedEvents = []) {
  return {
    find(query) {
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

test("normalizeSuggestionInput throws on missing windowStart", () => {
  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowStart is required/,
  );
});

test("normalizeSuggestionInput throws on missing windowEnd", () => {
  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        durationMinutes: 60,
      }),
    /windowEnd is required/,
  );
});

test("normalizeSuggestionInput throws on missing durationMinutes", () => {
  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
      }),
    /durationMinutes is required/,
  );
});

test("normalizeSuggestionInput sets defaults for minimumScore and maxSuggestions", () => {
  const result = normalizeSuggestionInput({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 60,
  });

  assert.equal(result.minimumScore, 0);
  assert.equal(result.maxSuggestions, 3);
});

test("normalizeSuggestionInput throws on minimumScore > 100", () => {
  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
        minimumScore: 120,
      }),
    /minimumScore must be between 0 and 100/,
  );

  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
        minimumScore: -10,
      }),
    /minimumScore must be between 0 and 100/,
  );
});

test("normalizeSuggestionInput throws on maxSuggestions <= 0", () => {
  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
        maxSuggestions: 0,
      }),
    /maxSuggestions must be a positive integer/,
  );

  assert.throws(
    () =>
      normalizeSuggestionInput({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        durationMinutes: 60,
        maxSuggestions: -5,
      }),
    /maxSuggestions must be a positive integer/,
  );
});

test("buildRelaxationPlans returns 5 levels", () => {
  const plans = buildRelaxationPlans();
  assert.equal(plans.length, 5);
  assert.deepEqual(
    plans.map((p) => p.level),
    [0, 1, 2, 3, 4],
  );
});

test("buildRelaxationPlans Level 0 preserves original preferences", () => {
  const prefs = {
    preferredStartHour: 10,
    preferredEndHour: 14,
    avoidLateDay: true,
    avoidEarlyMorning: true,
    earliestSlotBonus: true,
  };
  const plans = buildRelaxationPlans(prefs);
  const relaxed = applyRelaxationPlan(prefs, plans[0]);

  assert.deepEqual(relaxed, prefs);
  assert.equal(plans[0].relaxedConstraints.length, 0);
});

test("buildRelaxationPlans Level 1 removes preferred time window", () => {
  const prefs = {
    preferredStartHour: 10,
    preferredEndHour: 14,
    avoidLateDay: true,
    avoidEarlyMorning: true,
  };
  const plans = buildRelaxationPlans(prefs);
  const relaxed = applyRelaxationPlan(prefs, plans[1]);

  assert.equal(relaxed.preferredStartHour, null);
  assert.equal(relaxed.preferredEndHour, null);
  assert.equal(relaxed.avoidLateDay, true);
  assert.equal(relaxed.avoidEarlyMorning, true);
  assert.deepEqual(plans[1].relaxedConstraints, ["preferredTimeWindow"]);
});

test("buildRelaxationPlans Level 4 removes all soft constraints", () => {
  const prefs = {
    preferredStartHour: 10,
    preferredEndHour: 14,
    avoidLateDay: true,
    avoidEarlyMorning: true,
    earliestSlotBonus: true,
  };
  const plans = buildRelaxationPlans(prefs);
  const relaxed = applyRelaxationPlan(prefs, plans[4]);

  assert.equal(relaxed.preferredStartHour, null);
  assert.equal(relaxed.preferredEndHour, null);
  assert.equal(relaxed.avoidLateDay, false);
  assert.equal(relaxed.avoidEarlyMorning, false);
  assert.equal(relaxed.earliestSlotBonus, false);
});

test("applyRelaxationPlan produces correct relaxed preferences", () => {
  const base = {
    preferredStartHour: 9,
    preferredEndHour: 12,
    avoidLateDay: true,
    avoidEarlyMorning: true,
    earliestSlotBonus: true,
  };

  const level2 = applyRelaxationPlan(base, { level: 2 });
  assert.equal(level2.preferredStartHour, null);
  assert.equal(level2.preferredEndHour, null);
  assert.equal(level2.avoidLateDay, false);
  assert.equal(level2.avoidEarlyMorning, true);

  const level3 = applyRelaxationPlan(base, { level: 3 });
  assert.equal(level3.avoidEarlyMorning, false);
});

test("findSuggestionsWithRelaxation returns strict results at Level 0 when available", async () => {
  const EventModel = makeFakeEventModel([]);
  const result = await findSuggestionsWithRelaxation({
    ownerId: "owner-1",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 60,
    preferences: {
      preferredStartHour: 10,
      preferredEndHour: 12,
    },
    minimumScore: 70,
    EventModel,
  });

  assert.equal(result.relaxed, false);
  assert.equal(result.relaxationLevel, 0);
  assert.ok(result.suggestions.length > 0);
  assert.equal(result.suggestions[0].relaxedConstraints.length, 0);
});

test("findSuggestionsWithRelaxation relaxes to Level 1 when strict has no qualifying slots", async () => {
  const blockedEvent = {
    owner: "owner-1",
    startAt: new Date("2026-08-25T10:00:00.000Z"),
    endAt: new Date("2026-08-25T12:00:00.000Z"),
  };
  const EventModel = makeFakeEventModel([blockedEvent]);

  const result = await findSuggestionsWithRelaxation({
    ownerId: "owner-1",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 60,
    preferences: {
      preferredStartHour: 10,
      preferredEndHour: 12,
    },
    minimumScore: 70,
    EventModel,
  });

  assert.equal(result.relaxed, true);
  assert.equal(result.relaxationLevel, 1);
  assert.ok(result.suggestions.length > 0);
  assert.deepEqual(result.suggestions[0].relaxedConstraints, [
    "preferredTimeWindow",
  ]);
});

test("findSuggestionsWithRelaxation returns fallback at Level 4 when nothing qualifies", async () => {
  const EventModel = makeFakeEventModel([]);
  const result = await findSuggestionsWithRelaxation({
    ownerId: "owner-1",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T11:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 60,
    preferences: {},
    minimumScore: 100,
    EventModel,
  });

  assert.equal(result.relaxed, true);
  assert.equal(result.relaxationLevel, 4);
  assert.ok(result.suggestions.length > 0);
});

test("findSuggestionsWithRelaxation respects maxSuggestions limit", async () => {
  const EventModel = makeFakeEventModel([]);
  const result = await findSuggestionsWithRelaxation({
    ownerId: "owner-1",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 30,
    slotStepMinutes: 30,
    maxSuggestions: 2,
    EventModel,
  });

  assert.equal(result.suggestions.length, 2);
});

test("findSuggestionsWithRelaxation includes relaxationSteps metadata", async () => {
  const blockedEvent = {
    owner: "owner-1",
    startAt: new Date("2026-08-25T10:00:00.000Z"),
    endAt: new Date("2026-08-25T12:00:00.000Z"),
  };
  const EventModel = makeFakeEventModel([blockedEvent]);

  const result = await findSuggestionsWithRelaxation({
    ownerId: "owner-1",
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    durationMinutes: 60,
    slotStepMinutes: 60,
    preferences: {
      preferredStartHour: 10,
      preferredEndHour: 12,
    },
    minimumScore: 70,
    EventModel,
  });

  assert.ok(Array.isArray(result.relaxationSteps));
  assert.equal(result.relaxationSteps.length, 2);
  assert.equal(result.relaxationSteps[0].level, 0);
  assert.equal(result.relaxationSteps[1].level, 1);
});
