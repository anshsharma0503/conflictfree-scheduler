import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTimeRange,
  eventsOverlap,
  findConflictingEvents,
} from "../src/services/scheduling/conflictDetectionService.js";

function makeEvent(overrides = {}) {
  const base = {
    _id: "event-aaa",
    id: "event-aaa",
    owner: "owner-111",
    title: "Existing Meeting",
    location: "Room 1",
    ...overrides,
  };

  base.startAt = new Date(overrides.startAt || "2026-08-20T09:00:00.000Z");
  base.endAt = new Date(overrides.endAt || "2026-08-20T10:00:00.000Z");
  base.id = base._id;

  return base;
}

function idMatches(value, matcher) {
  if (matcher && typeof matcher === "object" && Array.isArray(matcher.$in)) {
    return matcher.$in.some((candidate) => String(candidate) === String(value));
  }

  return String(value) === String(matcher);
}

// Evaluates the same filter shape MongoDB receives: `status $ne cancelled`,
// open-interval overlap, optional `_id $ne`, and the `$or` occupancy matcher
// (owned events, or pending/accepted invitations by registered user id).
function makeFakeEventModel(storedEvents) {
  return {
    find(query) {
      const { startAt: startQuery, endAt: endQuery, _id: idQuery } = query;

      const proposedEnd = startQuery.$lt;
      const proposedStart = endQuery.$gt;
      const excludedId = idQuery?.$ne;

      const results = storedEvents.filter((ev) => {
        if ((ev.status || "active") === "cancelled") return false;

        const occupies = query.$or.some((clause) => {
          if (clause.owner !== undefined) {
            return idMatches(ev.owner, clause.owner);
          }

          const elem = clause.participants?.$elemMatch;
          return (ev.participants || []).some(
            (p) =>
              p.user &&
              idMatches(p.user, elem.user) &&
              elem.status.$in.includes(p.status || "pending"),
          );
        });

        if (!occupies) return false;
        if (excludedId && String(ev._id) === String(excludedId)) return false;
        return ev.startAt < proposedEnd && ev.endAt > proposedStart;
      });

      return {
        sort() {
          return [...results].sort((a, b) => a.startAt - b.startAt);
        },
      };
    },
  };
}

test("normalizeTimeRange returns start and end Date objects for valid input", () => {
  const { start, end } = normalizeTimeRange({
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
  });

  assert.ok(start instanceof Date);
  assert.ok(end instanceof Date);
  assert.equal(start.toISOString(), "2026-08-20T10:00:00.000Z");
  assert.equal(end.toISOString(), "2026-08-20T11:00:00.000Z");
});

test("normalizeTimeRange throws when startAt is missing", () => {
  assert.throws(
    () => normalizeTimeRange({ endAt: "2026-08-20T11:00:00.000Z" }),
    /startAt is required/,
  );
});

test("normalizeTimeRange throws when endAt is missing", () => {
  assert.throws(
    () => normalizeTimeRange({ startAt: "2026-08-20T10:00:00.000Z" }),
    /endAt is required/,
  );
});

test("normalizeTimeRange throws for invalid startAt string", () => {
  assert.throws(
    () =>
      normalizeTimeRange({
        startAt: "not-a-date",
        endAt: "2026-08-20T11:00:00.000Z",
      }),
    /startAt must be a valid date/,
  );
});

test("normalizeTimeRange throws for invalid endAt string", () => {
  assert.throws(
    () =>
      normalizeTimeRange({
        startAt: "2026-08-20T10:00:00.000Z",
        endAt: "not-a-date",
      }),
    /endAt must be a valid date/,
  );
});

test("normalizeTimeRange throws when endAt equals startAt", () => {
  assert.throws(
    () =>
      normalizeTimeRange({
        startAt: "2026-08-20T10:00:00.000Z",
        endAt: "2026-08-20T10:00:00.000Z",
      }),
    /endAt must be after startAt/,
  );
});

test("normalizeTimeRange throws when endAt is before startAt", () => {
  assert.throws(
    () =>
      normalizeTimeRange({
        startAt: "2026-08-20T11:00:00.000Z",
        endAt: "2026-08-20T10:00:00.000Z",
      }),
    /endAt must be after startAt/,
  );
});

test("eventsOverlap: proposed starts during existing event → overlap", () => {
  const existing = {
    start: new Date("2026-08-20T09:00:00.000Z"),
    end: new Date("2026-08-20T10:00:00.000Z"),
  };
  const proposed = {
    start: new Date("2026-08-20T09:30:00.000Z"),
    end: new Date("2026-08-20T10:30:00.000Z"),
  };

  assert.equal(eventsOverlap(existing, proposed), true);
});

test("eventsOverlap: proposed ends during existing event → overlap", () => {
  const existing = {
    start: new Date("2026-08-20T10:00:00.000Z"),
    end: new Date("2026-08-20T11:00:00.000Z"),
  };
  const proposed = {
    start: new Date("2026-08-20T09:30:00.000Z"),
    end: new Date("2026-08-20T10:30:00.000Z"),
  };

  assert.equal(eventsOverlap(existing, proposed), true);
});

test("eventsOverlap: proposed completely surrounds existing event → overlap", () => {
  const existing = {
    start: new Date("2026-08-20T10:00:00.000Z"),
    end: new Date("2026-08-20T10:30:00.000Z"),
  };
  const proposed = {
    start: new Date("2026-08-20T09:00:00.000Z"),
    end: new Date("2026-08-20T12:00:00.000Z"),
  };

  assert.equal(eventsOverlap(existing, proposed), true);
});

test("eventsOverlap: proposed ends exactly at existing start → no overlap", () => {
  const existing = {
    start: new Date("2026-08-20T10:00:00.000Z"),
    end: new Date("2026-08-20T11:00:00.000Z"),
  };
  const proposed = {
    start: new Date("2026-08-20T09:00:00.000Z"),
    end: new Date("2026-08-20T10:00:00.000Z"),
  };

  assert.equal(eventsOverlap(existing, proposed), false);
});

test("eventsOverlap: proposed starts exactly at existing end → no overlap", () => {
  const existing = {
    start: new Date("2026-08-20T09:00:00.000Z"),
    end: new Date("2026-08-20T10:00:00.000Z"),
  };
  const proposed = {
    start: new Date("2026-08-20T10:00:00.000Z"),
    end: new Date("2026-08-20T11:00:00.000Z"),
  };

  assert.equal(eventsOverlap(existing, proposed), false);
});

test("findConflictingEvents: detects overlap when proposed starts during existing event", async () => {
  const existing = makeEvent({
    _id: "event-aaa",
    startAt: "2026-08-20T09:00:00.000Z",
    endAt: "2026-08-20T10:00:00.000Z",
    owner: "owner-111",
  });

  const EventModel = makeFakeEventModel([existing]);

  const conflicts = await findConflictingEvents({
    ownerId: "owner-111",
    startAt: "2026-08-20T09:30:00.000Z",
    endAt: "2026-08-20T10:30:00.000Z",
    EventModel,
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]._id, "event-aaa");
});

test("findConflictingEvents: detects overlap when proposed ends during existing event", async () => {
  const existing = makeEvent({
    _id: "event-bbb",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    owner: "owner-111",
  });

  const EventModel = makeFakeEventModel([existing]);

  const conflicts = await findConflictingEvents({
    ownerId: "owner-111",
    startAt: "2026-08-20T09:30:00.000Z",
    endAt: "2026-08-20T10:30:00.000Z",
    EventModel,
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]._id, "event-bbb");
});

test("findConflictingEvents: detects overlap when proposed completely surrounds existing event", async () => {
  const existing = makeEvent({
    _id: "event-ccc",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T10:30:00.000Z",
    owner: "owner-111",
  });

  const EventModel = makeFakeEventModel([existing]);

  const conflicts = await findConflictingEvents({
    ownerId: "owner-111",
    startAt: "2026-08-20T09:00:00.000Z",
    endAt: "2026-08-20T12:00:00.000Z",
    EventModel,
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]._id, "event-ccc");
});

test("findConflictingEvents: no overlap when proposed ends exactly at existing start", async () => {
  const existing = makeEvent({
    _id: "event-ddd",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    owner: "owner-111",
  });

  const EventModel = makeFakeEventModel([existing]);

  const conflicts = await findConflictingEvents({
    ownerId: "owner-111",
    startAt: "2026-08-20T09:00:00.000Z",
    endAt: "2026-08-20T10:00:00.000Z",
    EventModel,
  });

  assert.equal(conflicts.length, 0);
});

test("findConflictingEvents: no overlap when proposed starts exactly at existing end", async () => {
  const existing = makeEvent({
    _id: "event-eee",
    startAt: "2026-08-20T09:00:00.000Z",
    endAt: "2026-08-20T10:00:00.000Z",
    owner: "owner-111",
  });

  const EventModel = makeFakeEventModel([existing]);

  const conflicts = await findConflictingEvents({
    ownerId: "owner-111",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    EventModel,
  });

  assert.equal(conflicts.length, 0);
});

test("findConflictingEvents: throws for missing startAt", async () => {
  const EventModel = makeFakeEventModel([]);

  await assert.rejects(
    () =>
      findConflictingEvents({
        ownerId: "owner-111",
        endAt: "2026-08-20T11:00:00.000Z",
        EventModel,
      }),
    /startAt is required/,
  );
});

test("findConflictingEvents: throws for missing endAt", async () => {
  const EventModel = makeFakeEventModel([]);

  await assert.rejects(
    () =>
      findConflictingEvents({
        ownerId: "owner-111",
        startAt: "2026-08-20T10:00:00.000Z",
        EventModel,
      }),
    /endAt is required/,
  );
});

test("findConflictingEvents: throws for endAt equal to startAt", async () => {
  const EventModel = makeFakeEventModel([]);

  await assert.rejects(
    () =>
      findConflictingEvents({
        ownerId: "owner-111",
        startAt: "2026-08-20T10:00:00.000Z",
        endAt: "2026-08-20T10:00:00.000Z",
        EventModel,
      }),
    /endAt must be after startAt/,
  );
});

test("findConflictingEvents: throws for endAt before startAt", async () => {
  const EventModel = makeFakeEventModel([]);

  await assert.rejects(
    () =>
      findConflictingEvents({
        ownerId: "owner-111",
        startAt: "2026-08-20T11:00:00.000Z",
        endAt: "2026-08-20T10:00:00.000Z",
        EventModel,
      }),
    /endAt must be after startAt/,
  );
});

test("findConflictingEvents: excludeEventId prevents self-conflict", async () => {
  const existing = makeEvent({
    _id: "event-fff",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    owner: "owner-111",
  });

  const EventModel = makeFakeEventModel([existing]);

  const conflicts = await findConflictingEvents({
    ownerId: "owner-111",
    startAt: "2026-08-20T10:00:00.000Z",
    endAt: "2026-08-20T11:00:00.000Z",
    excludeEventId: "event-fff",
    EventModel,
  });

  assert.equal(conflicts.length, 0);
});

test("findConflictingEvents: accepted and pending invitations conflict, declined and cancelled do not", async () => {
  const userId = "invitee-222";
  const stored = [
    makeEvent({
      _id: "accepted-meeting",
      owner: "organizer-999",
      participants: [{ user: userId, status: "accepted" }],
    }),
    makeEvent({
      _id: "pending-meeting",
      owner: "organizer-999",
      startAt: "2026-08-20T09:15:00.000Z",
      endAt: "2026-08-20T09:45:00.000Z",
      participants: [{ user: userId, status: "pending" }],
    }),
    makeEvent({
      _id: "declined-meeting",
      owner: "organizer-999",
      participants: [{ user: userId, status: "declined" }],
    }),
    makeEvent({
      _id: "cancelled-meeting",
      owner: "organizer-999",
      status: "cancelled",
      participants: [{ user: userId, status: "accepted" }],
    }),
  ];

  const conflicts = await findConflictingEvents({
    ownerId: userId,
    startAt: "2026-08-20T09:30:00.000Z",
    endAt: "2026-08-20T10:30:00.000Z",
    EventModel: makeFakeEventModel(stored),
  });

  assert.deepEqual(
    conflicts.map((event) => event._id).sort(),
    ["accepted-meeting", "pending-meeting"],
  );
});

test("findConflictingEvents: an invitation matched only by free-text email never conflicts", async () => {
  const stored = [
    makeEvent({
      _id: "email-only",
      owner: "someone-else",
      participants: [{ user: null, email: "victim@example.com", status: "accepted" }],
    }),
  ];

  const conflicts = await findConflictingEvents({
    ownerId: "victim-333",
    startAt: "2026-08-20T09:00:00.000Z",
    endAt: "2026-08-20T10:00:00.000Z",
    EventModel: makeFakeEventModel(stored),
  });

  assert.equal(conflicts.length, 0);
});
