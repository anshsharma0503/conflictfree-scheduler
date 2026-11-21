import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  intervalsOverlap,
  sortPaletteDeterministically,
  ResourceConflictGraph,
  allocateResourceForCandidateSlot,
} from "../src/services/scheduling/resourceGraphColoringService.js";
import { findAvailableSlots } from "../src/services/scheduling/availableSlotService.js";
import { findSuggestionsWithRelaxation } from "../src/services/scheduling/backtrackingSchedulingService.js";

test("intervalsOverlap: detects overlapping open intervals correctly", () => {
  // Overlapping
  assert.equal(
    intervalsOverlap(
      { startAt: new Date("2026-11-03T09:00:00Z"), endAt: new Date("2026-11-03T10:00:00Z") },
      { startAt: new Date("2026-11-03T09:30:00Z"), endAt: new Date("2026-11-03T10:30:00Z") },
    ),
    true,
  );

  // Contained
  assert.equal(
    intervalsOverlap(
      { startAt: new Date("2026-11-03T09:00:00Z"), endAt: new Date("2026-11-03T11:00:00Z") },
      { startAt: new Date("2026-11-03T09:30:00Z"), endAt: new Date("2026-11-03T10:00:00Z") },
    ),
    true,
  );

  // Back-to-back: start equals end (should NOT overlap in open interval)
  assert.equal(
    intervalsOverlap(
      { startAt: new Date("2026-11-03T09:00:00Z"), endAt: new Date("2026-11-03T10:00:00Z") },
      { startAt: new Date("2026-11-03T10:00:00Z"), endAt: new Date("2026-11-03T11:00:00Z") },
    ),
    false,
  );

  // Completely disjoint
  assert.equal(
    intervalsOverlap(
      { startAt: new Date("2026-11-03T09:00:00Z"), endAt: new Date("2026-11-03T10:00:00Z") },
      { startAt: new Date("2026-11-03T11:00:00Z"), endAt: new Date("2026-11-03T12:00:00Z") },
    ),
    false,
  );
});

test("ResourceConflictGraph: creates vertices and edges for overlapping intervals but not back-to-back", () => {
  const graph = new ResourceConflictGraph();

  // Candidate: 10:00 - 11:00
  graph.addVertex({
    id: "candidate",
    startAt: new Date("2026-11-03T10:00:00Z"),
    endAt: new Date("2026-11-03T11:00:00Z"),
    isCandidate: true,
  });

  // Event 1: 09:00 - 10:00 (Back-to-back with candidate -> NO edge)
  graph.addVertex({
    id: "ev1",
    startAt: new Date("2026-11-03T09:00:00Z"),
    endAt: new Date("2026-11-03T10:00:00Z"),
    resourceId: "res-a",
  });

  // Event 2: 10:30 - 11:30 (Overlaps candidate -> EDGE)
  graph.addVertex({
    id: "ev2",
    startAt: new Date("2026-11-03T10:30:00Z"),
    endAt: new Date("2026-11-03T11:30:00Z"),
    resourceId: "res-b",
  });

  graph.buildIntervalEdges();

  const candidateAdj = graph.adjacency.get("candidate");
  assert.equal(candidateAdj.has("ev1"), false, "ev1 is back-to-back so no edge");
  assert.equal(candidateAdj.has("ev2"), true, "ev2 overlaps candidate so edge exists");

  const ev1Adj = graph.adjacency.get("ev1");
  assert.equal(ev1Adj.has("ev2"), false, "ev1 and ev2 do not overlap");
});

test("sortPaletteDeterministically: orders resources alphabetically by name then id", () => {
  const r1 = { _id: "bbb", name: "Zebra Room" };
  const r2 = { _id: "aaa", name: "Alpha Room" };
  const r3 = { _id: "ccc", name: "Alpha Room" };

  const sorted = sortPaletteDeterministically([r1, r2, r3]);
  assert.equal(sorted[0].name, "Alpha Room");
  assert.equal(sorted[0]._id, "aaa");
  assert.equal(sorted[1].name, "Alpha Room");
  assert.equal(sorted[1]._id, "ccc");
  assert.equal(sorted[2].name, "Zebra Room");
});

test("Graph coloring assigns a free eligible resource", () => {
  const roomA = { _id: "res-a", name: "Room A", type: "room", capacity: 8, location: "1F" };
  const roomB = { _id: "res-b", name: "Room B", type: "room", capacity: 10, location: "2F" };

  const allocation = allocateResourceForCandidateSlot({
    candidateSlot: {
      startAt: new Date("2026-11-03T10:00:00Z"),
      endAt: new Date("2026-11-03T11:00:00Z"),
    },
    overlappingEvents: [],
    eligiblePalette: [roomA, roomB],
    attendeeCount: 6,
  });

  assert.notEqual(allocation, null);
  assert.equal(allocation.allocatedResource.id, "res-a");
  assert.equal(allocation.allocatedResource.name, "Room A");
  assert.match(allocation.allocationReason, /Room A is active, fits 6 attendees/);
});

test("Existing overlapping event blocks its resource color", () => {
  const roomA = { _id: "res-a", name: "Room A", type: "room", capacity: 8 };
  const roomB = { _id: "res-b", name: "Room B", type: "room", capacity: 10 };

  // Event in Room A overlaps candidate slot
  const overlappingEvent = {
    _id: "event-1",
    resource: "res-a",
    startAt: new Date("2026-11-03T10:15:00Z"),
    endAt: new Date("2026-11-03T10:45:00Z"),
  };

  const allocation = allocateResourceForCandidateSlot({
    candidateSlot: {
      startAt: new Date("2026-11-03T10:00:00Z"),
      endAt: new Date("2026-11-03T11:00:00Z"),
    },
    overlappingEvents: [overlappingEvent],
    eligiblePalette: [roomA, roomB],
    attendeeCount: 4,
  });

  assert.notEqual(allocation, null);
  // Room A is occupied, so greedy coloring skips Room A and chooses Room B!
  assert.equal(allocation.allocatedResource.id, "res-b");
  assert.equal(allocation.allocatedResource.name, "Room B");
});

test("Multiple overlapping resource bookings eliminate multiple colors", () => {
  const roomA = { _id: "res-a", name: "Room A", type: "room", capacity: 8 };
  const roomB = { _id: "res-b", name: "Room B", type: "room", capacity: 10 };
  const roomC = { _id: "res-c", name: "Room C", type: "room", capacity: 12 };

  const evA = {
    _id: "ev-a",
    resource: "res-a",
    startAt: new Date("2026-11-03T09:30:00Z"),
    endAt: new Date("2026-11-03T10:30:00Z"),
  };
  const evB = {
    _id: "ev-b",
    resource: "res-b",
    startAt: new Date("2026-11-03T10:15:00Z"),
    endAt: new Date("2026-11-03T11:15:00Z"),
  };

  const allocation = allocateResourceForCandidateSlot({
    candidateSlot: {
      startAt: new Date("2026-11-03T10:00:00Z"),
      endAt: new Date("2026-11-03T11:00:00Z"),
    },
    overlappingEvents: [evA, evB],
    eligiblePalette: [roomA, roomB, roomC],
    attendeeCount: 5,
  });

  assert.notEqual(allocation, null);
  // res-a and res-b are forbidden, so res-c is selected
  assert.equal(allocation.allocatedResource.id, "res-c");
  assert.equal(allocation.allocatedResource.name, "Room C");
});

test("Returns null when every eligible resource is occupied", () => {
  const roomA = { _id: "res-a", name: "Room A", type: "room", capacity: 8 };
  const roomB = { _id: "res-b", name: "Room B", type: "room", capacity: 10 };

  const evA = {
    _id: "ev-a",
    resource: "res-a",
    startAt: new Date("2026-11-03T10:00:00Z"),
    endAt: new Date("2026-11-03T11:00:00Z"),
  };
  const evB = {
    _id: "ev-b",
    resource: "res-b",
    startAt: new Date("2026-11-03T10:00:00Z"),
    endAt: new Date("2026-11-03T11:00:00Z"),
  };

  const allocation = allocateResourceForCandidateSlot({
    candidateSlot: {
      startAt: new Date("2026-11-03T10:00:00Z"),
      endAt: new Date("2026-11-03T11:00:00Z"),
    },
    overlappingEvents: [evA, evB],
    eligiblePalette: [roomA, roomB],
    attendeeCount: 4,
  });

  assert.equal(allocation, null, "Should return null when all colors are taken");
});

test("Allocation response contains no sensitive event details", () => {
  const roomA = { _id: "res-a", name: "Room A", type: "room", capacity: 8, location: "Room 101" };

  const allocation = allocateResourceForCandidateSlot({
    candidateSlot: {
      startAt: new Date("2026-11-03T10:00:00Z"),
      endAt: new Date("2026-11-03T11:00:00Z"),
    },
    overlappingEvents: [],
    eligiblePalette: [roomA],
    attendeeCount: 6,
  });

  assert.notEqual(allocation, null);
  const resource = allocation.allocatedResource;
  assert.equal(resource.id, "res-a");
  assert.equal(resource.name, "Room A");
  assert.equal(resource.type, "room");
  assert.equal(resource.capacity, 8);
  assert.equal(resource.location, "Room 101");

  // Verify no sensitive fields leaked
  assert.equal(resource.password, undefined);
  assert.equal(resource.passwordHash, undefined);
  assert.equal(resource.googleId, undefined);
  assert.equal(resource.owner, undefined);
  assert.equal(resource.participants, undefined);
});

test("Timezone changes do not alter UTC overlap and graph correctness", () => {
  const roomA = { _id: "res-a", name: "Room A", type: "room", capacity: 8 };

  // Meeting booked at 10:00 UTC (15:30 IST)
  const overlappingEvent = {
    _id: "ev-1",
    resource: "res-a",
    startAt: new Date("2026-11-03T10:00:00.000Z"),
    endAt: new Date("2026-11-03T11:00:00.000Z"),
  };

  // Proposed candidate slot in Asia/Kolkata timezone: 15:30 to 16:30 IST (10:00 to 11:00 UTC)
  const candidateSlot = {
    startAt: new Date("2026-11-03T10:00:00.000Z"),
    endAt: new Date("2026-11-03T11:00:00.000Z"),
  };

  const allocation = allocateResourceForCandidateSlot({
    candidateSlot,
    overlappingEvents: [overlappingEvent],
    eligiblePalette: [roomA],
  });

  assert.equal(allocation, null, "Overlaps in absolute UTC instant regardless of timezone");
});

test("findAvailableSlots with autoAllocateResource removes candidates with no allocatable resource", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const roomAId = new mongoose.Types.ObjectId();
  const roomBId = new mongoose.Types.ObjectId();

  const mockResources = [
    { _id: roomAId, name: "Room A", type: "room", capacity: 5, isActive: true },
    { _id: roomBId, name: "Room B", type: "room", capacity: 10, isActive: true },
  ];

  // Room A is booked 09:00 - 11:00
  // Room B is booked 10:00 - 12:00
  // In interval 10:00 - 11:00, BOTH are booked!
  // In interval 09:00 - 10:00, Room B is free!
  // In interval 11:00 - 12:00, Room A is free!
  const mockEvents = [
    {
      _id: new mongoose.Types.ObjectId(),
      resource: roomAId,
      startAt: new Date("2026-11-03T09:00:00Z"),
      endAt: new Date("2026-11-03T11:00:00Z"),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      resource: roomBId,
      startAt: new Date("2026-11-03T10:00:00Z"),
      endAt: new Date("2026-11-03T12:00:00Z"),
    },
  ];

  const MockEventModel = {
    find: (query) => {
      // If querying user events for availability
      if (query.owner) {
        return {
          select: () => ({
            sort: async () => [],
          }),
        };
      }
      // If querying resource bookings
      return {
        select: () => ({
          lean: async () => mockEvents,
        }),
      };
    },
  };

  const MockResourceModel = {
    find: (query) => ({
      lean: async () => {
        let list = [...mockResources];
        if (query.type) list = list.filter((r) => r.type === query.type);
        if (query.capacity?.$gte) list = list.filter((r) => r.capacity >= query.capacity.$gte);
        return list;
      },
    }),
  };

  const slots = await findAvailableSlots({
    ownerId,
    windowStart: "2026-11-03T09:00:00Z",
    windowEnd: "2026-11-03T12:00:00Z",
    durationMinutes: 60,
    slotStepMinutes: 60,
    autoAllocateResource: true,
    resourceType: "room",
    EventModel: MockEventModel,
    ResourceModel: MockResourceModel,
  });

  // Candidate slots would normally be 09:00-10:00, 10:00-11:00, 11:00-12:00
  // 10:00-11:00 must be REMOVED because both Room A and Room B are booked!
  assert.equal(slots.length, 2);

  const slot1 = slots.find((s) => s.startAt.toISOString() === "2026-11-03T09:00:00.000Z");
  assert.notEqual(slot1, undefined);
  assert.equal(slot1.allocatedResource.id, roomBId.toString());

  const slot2 = slots.find((s) => s.startAt.toISOString() === "2026-11-03T11:00:00.000Z");
  assert.notEqual(slot2, undefined);
  assert.equal(slot2.allocatedResource.id, roomAId.toString());

  const blockedSlot = slots.find((s) => s.startAt.toISOString() === "2026-11-03T10:00:00.000Z");
  assert.equal(blockedSlot, undefined, "Candidate slot with no allocatable resource is discarded");
});

test("findSuggestionsWithRelaxation attaches auto-allocated resource to suggestions", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const roomAId = new mongoose.Types.ObjectId();

  const mockResources = [
    { _id: roomAId, name: "Studio Room", type: "room", capacity: 6, isActive: true },
  ];

  const MockEventModel = {
    find: (query) => {
      if (query.owner) {
        return {
          select: () => ({
            sort: async () => [],
          }),
        };
      }
      return {
        select: () => ({
          lean: async () => [],
        }),
      };
    },
  };

  const MockResourceModel = {
    find: () => ({
      lean: async () => mockResources,
    }),
  };

  const result = await findSuggestionsWithRelaxation({
    ownerId,
    windowStart: "2026-11-03T09:00:00Z",
    windowEnd: "2026-11-03T12:00:00Z",
    durationMinutes: 60,
    autoAllocateResource: true,
    resourceType: "room",
    attendeeCount: 4,
    EventModel: MockEventModel,
    ResourceModel: MockResourceModel,
  });

  assert.equal(result.suggestions.length > 0, true);
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.allocatedResource.id, roomAId.toString());
    assert.match(suggestion.allocationReason, /Studio Room is active, fits 4 attendees/);
  }
});

