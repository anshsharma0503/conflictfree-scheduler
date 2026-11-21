import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSlotPreferences,
  scoreSlot,
  rankSlots,
} from "../src/services/scheduling/slotScoringService.js";

test("normalizeSlotPreferences returns defaults for empty input", () => {
  const prefs = normalizeSlotPreferences();

  assert.deepEqual(prefs, {
    preferredStartHour: null,
    preferredEndHour: null,
    avoidEarlyMorning: false,
    avoidLateDay: false,
    earliestSlotBonus: false,
    timezone: "UTC",
  });
});

test("normalizeSlotPreferences validates and normalizes provided preferences", () => {
  const prefs = normalizeSlotPreferences({
    preferredStartHour: 13,
    preferredEndHour: 17,
    avoidEarlyMorning: true,
    avoidLateDay: true,
    earliestSlotBonus: true,
    timezone: "Asia/Kolkata",
  });

  assert.deepEqual(prefs, {
    preferredStartHour: 13,
    preferredEndHour: 17,
    avoidEarlyMorning: true,
    avoidLateDay: true,
    earliestSlotBonus: true,
    timezone: "Asia/Kolkata",
  });
});

test("normalizeSlotPreferences ignores invalid hours and falls back to UTC for invalid timezone", () => {
  const prefs = normalizeSlotPreferences({
    preferredStartHour: -5,
    preferredEndHour: 30,
    timezone: "Invalid/Zone",
  });

  assert.equal(prefs.preferredStartHour, null);
  assert.equal(prefs.preferredEndHour, null);
  assert.equal(prefs.timezone, "UTC");
});

test("scoreSlot returns base score 50 without preferences", () => {
  const slot = {
    startAt: new Date("2026-08-25T11:00:00.000Z"),
    endAt: new Date("2026-08-25T12:00:00.000Z"),
  };

  const scored = scoreSlot(slot, {});

  assert.equal(scored.score, 50);
  assert.deepEqual(scored.reasons, []);
});

test("scoreSlot applies preferred window bonus (+30)", () => {
  const slotInside = {
    startAt: new Date("2026-08-25T14:00:00.000Z"),
    endAt: new Date("2026-08-25T15:00:00.000Z"),
  };

  const scored = scoreSlot(slotInside, {
    preferredStartHour: 13,
    preferredEndHour: 17,
  });

  assert.equal(scored.score, 80);
  assert.ok(scored.reasons.includes("Inside preferred time window"));
});

test("scoreSlot applies avoidEarlyMorning penalty (-15) when start is before 10:00 UTC", () => {
  const earlySlot = {
    startAt: new Date("2026-08-25T09:00:00.000Z"),
    endAt: new Date("2026-08-25T10:00:00.000Z"),
  };

  const scored = scoreSlot(earlySlot, {
    avoidEarlyMorning: true,
  });

  assert.equal(scored.score, 35);
  assert.ok(scored.reasons.includes("Early morning penalty"));
});

test("scoreSlot applies avoidEarlyMorning bonus (+5) when start is 10:00 UTC or later", () => {
  const midMorningSlot = {
    startAt: new Date("2026-08-25T10:00:00.000Z"),
    endAt: new Date("2026-08-25T11:00:00.000Z"),
  };

  const scored = scoreSlot(midMorningSlot, {
    avoidEarlyMorning: true,
  });

  assert.equal(scored.score, 55);
  assert.ok(scored.reasons.includes("Avoids early morning"));
});

test("scoreSlot applies avoidLateDay penalty (-10) when end is after 17:00 UTC", () => {
  const lateSlot = {
    startAt: new Date("2026-08-25T17:00:00.000Z"),
    endAt: new Date("2026-08-25T18:00:00.000Z"),
  };

  const scored = scoreSlot(lateSlot, {
    avoidLateDay: true,
  });

  assert.equal(scored.score, 40);
  assert.ok(scored.reasons.includes("Late day penalty"));
});

test("scoreSlot applies avoidLateDay bonus (+5) when end is 17:00 UTC or earlier", () => {
  const afternoonSlot = {
    startAt: new Date("2026-08-25T16:00:00.000Z"),
    endAt: new Date("2026-08-25T17:00:00.000Z"),
  };

  const scored = scoreSlot(afternoonSlot, {
    avoidLateDay: true,
  });

  assert.equal(scored.score, 55);
  assert.ok(scored.reasons.includes("Avoids late day"));
});

test("scoreSlot applies earliestSlotBonus", () => {
  const slot = {
    startAt: new Date("2026-08-25T11:00:00.000Z"),
    endAt: new Date("2026-08-25T12:00:00.000Z"),
  };

  const firstSlot = scoreSlot(slot, { earliestSlotBonus: true }, 0);
  const secondSlot = scoreSlot(slot, { earliestSlotBonus: true }, 1);
  const lateIndexSlot = scoreSlot(slot, { earliestSlotBonus: true }, 6);

  assert.equal(firstSlot.score, 60); // 50 + 10
  assert.ok(firstSlot.reasons.includes("Earliest slot bonus"));

  assert.equal(secondSlot.score, 58); // 50 + 8
  assert.ok(secondSlot.reasons.includes("Earliest slot bonus"));

  assert.equal(lateIndexSlot.score, 50); // 50 + 0
  assert.equal(lateIndexSlot.reasons.includes("Earliest slot bonus"), false);
});

test("scoreSlot clamps score between 0 and 100", () => {
  const idealSlot = {
    startAt: new Date("2026-08-25T14:00:00.000Z"),
    endAt: new Date("2026-08-25T15:00:00.000Z"),
  };

  const maxScored = scoreSlot(
    idealSlot,
    {
      preferredStartHour: 13,
      preferredEndHour: 17,
      avoidEarlyMorning: true,
      avoidLateDay: true,
      earliestSlotBonus: true,
    },
    0,
  );

  assert.equal(maxScored.score, 100);
});

test("Test 1: Asia/Kolkata 10:30 AM slot (05:00 UTC) avoids early morning and avoids penalty", () => {
  const slot1030Kolkata = {
    startAt: new Date("2026-09-26T05:00:00.000Z"), // 10:30 AM IST
    endAt: new Date("2026-09-26T06:00:00.000Z"),   // 11:30 AM IST
  };

  const scored = scoreSlot(slot1030Kolkata, {
    avoidEarlyMorning: true,
    timezone: "Asia/Kolkata",
  });

  assert.equal(scored.score, 55); // 50 + 5
  assert.ok(scored.reasons.includes("Avoids early morning"));
  assert.equal(scored.reasons.includes("Early morning penalty"), false);
});

test("Test 2: Asia/Kolkata 8:00 AM slot (02:30 UTC) receives early morning penalty", () => {
  const earlyKolkata = {
    startAt: new Date("2026-09-26T02:30:00.000Z"), // 8:00 AM IST
    endAt: new Date("2026-09-26T03:30:00.000Z"),   // 9:00 AM IST
  };

  const scored = scoreSlot(earlyKolkata, {
    avoidEarlyMorning: true,
    timezone: "Asia/Kolkata",
  });

  assert.equal(scored.score, 35); // 50 - 15
  assert.ok(scored.reasons.includes("Early morning penalty"));
  assert.equal(scored.reasons.includes("Avoids early morning"), false);
});

test("Test 3: Asia/Kolkata preferred time window (11:00-14:00) matches 11:30 AM IST (06:00 UTC)", () => {
  const slot1130Kolkata = {
    startAt: new Date("2026-09-26T06:00:00.000Z"), // 11:30 AM IST (UTC hour 6)
    endAt: new Date("2026-09-26T07:00:00.000Z"),   // 12:30 PM IST
  };

  const scored = scoreSlot(slot1130Kolkata, {
    preferredStartHour: 11,
    preferredEndHour: 14,
    timezone: "Asia/Kolkata",
  });

  assert.equal(scored.score, 80); // 50 + 30
  assert.ok(scored.reasons.includes("Inside preferred time window"));
});

test("Test 4: Asia/Kolkata slot ending at 5:30 PM IST (12:00 UTC) receives late day penalty", () => {
  const lateKolkata = {
    startAt: new Date("2026-09-26T11:00:00.000Z"), // 4:30 PM IST
    endAt: new Date("2026-09-26T12:00:00.000Z"),   // 5:30 PM IST (17:30 local)
  };

  const scored = scoreSlot(lateKolkata, {
    avoidLateDay: true,
    timezone: "Asia/Kolkata",
  });

  assert.equal(scored.score, 40); // 50 - 10
  assert.ok(scored.reasons.includes("Late day penalty"));
});

test("Test 5: The same UTC instant (2026-09-26T05:00:00Z) produces different scoring in different timezones", () => {
  const slot = {
    startAt: new Date("2026-09-26T05:00:00.000Z"),
    endAt: new Date("2026-09-26T06:00:00.000Z"),
  };

  const kolkataScored = scoreSlot(slot, {
    avoidEarlyMorning: true,
    timezone: "Asia/Kolkata",
  });
  assert.ok(kolkataScored.reasons.includes("Avoids early morning"));

  const nyScored = scoreSlot(slot, {
    avoidEarlyMorning: true,
    timezone: "America/New_York",
  });
  assert.ok(nyScored.reasons.includes("Early morning penalty"));

  const londonScored = scoreSlot(slot, {
    avoidEarlyMorning: true,
    timezone: "Europe/London",
  });
  assert.ok(londonScored.reasons.includes("Early morning penalty"));
});

test("rankSlots sorts best-first using MinHeap and breaks ties by earlier start time", () => {
  const slots = [
    {
      startAt: new Date("2026-08-25T09:00:00.000Z"),
      endAt: new Date("2026-08-25T10:00:00.000Z"),
    },
    {
      startAt: new Date("2026-08-25T11:00:00.000Z"),
      endAt: new Date("2026-08-25T12:00:00.000Z"),
    },
    {
      startAt: new Date("2026-08-25T14:00:00.000Z"),
      endAt: new Date("2026-08-25T15:00:00.000Z"),
    },
    {
      startAt: new Date("2026-08-25T15:00:00.000Z"),
      endAt: new Date("2026-08-25T16:00:00.000Z"),
    },
    {
      startAt: new Date("2026-08-25T18:00:00.000Z"),
      endAt: new Date("2026-08-25T19:00:00.000Z"),
    },
  ];

  const preferences = {
    preferredStartHour: 13,
    preferredEndHour: 17,
    avoidEarlyMorning: true,
    avoidLateDay: true,
    timezone: "UTC",
  };

  const ranked = rankSlots(slots, preferences);

  assert.equal(ranked[0].startAt.getUTCHours(), 14);
  assert.equal(ranked[0].score, 90);

  assert.equal(ranked[1].startAt.getUTCHours(), 15);
  assert.equal(ranked[1].score, 90);

  assert.equal(ranked[2].startAt.getUTCHours(), 11);
  assert.equal(ranked[2].score, 60);

  assert.equal(ranked[3].startAt.getUTCHours(), 18);
  assert.equal(ranked[3].score, 45);

  assert.equal(ranked[4].startAt.getUTCHours(), 9);
  assert.equal(ranked[4].score, 40);
});
