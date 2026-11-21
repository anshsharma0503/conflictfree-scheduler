import Resource from "../../models/Resource.js";
import Event from "../../models/Event.js";
import { formatSafeResourceSummary } from "../resourceAvailabilityService.js";

/**
 * Checks whether two time intervals overlap in open intervals (start1 < end2 && end1 > start2).
 */
export function intervalsOverlap(range1, range2) {
  const start1 =
    range1.startAt instanceof Date ? range1.startAt : new Date(range1.startAt);
  const end1 =
    range1.endAt instanceof Date ? range1.endAt : new Date(range1.endAt);
  const start2 =
    range2.startAt instanceof Date ? range2.startAt : new Date(range2.startAt);
  const end2 =
    range2.endAt instanceof Date ? range2.endAt : new Date(range2.endAt);

  return start1 < end2 && end1 > start2;
}

/**
 * Deterministically sorts resources alphabetically by name (case-insensitive), then by _id.
 */
export function sortPaletteDeterministically(resources = []) {
  return [...resources].sort((a, b) => {
    const nameA = a.name || "";
    const nameB = b.name || "";
    const nameComp = nameA.localeCompare(nameB, "en", { sensitivity: "base" });
    if (nameComp !== 0) return nameComp;
    const idA = (a._id || a.id || "").toString();
    const idB = (b._id || b.id || "").toString();
    return idA.localeCompare(idB);
  });
}

/**
 * Custom ResourceConflictGraph for fixed-color greedy graph coloring.
 */
export class ResourceConflictGraph {
  constructor() {
    this.vertices = new Map(); // id -> { id, startAt, endAt, isCandidate, resourceId, color }
    this.adjacency = new Map(); // id -> Set of neighbor vertex ids
  }

  addVertex({ id, startAt, endAt, isCandidate = false, resourceId = null }) {
    const vertex = {
      id: id.toString(),
      startAt: startAt instanceof Date ? startAt : new Date(startAt),
      endAt: endAt instanceof Date ? endAt : new Date(endAt),
      isCandidate,
      resourceId: resourceId ? resourceId.toString() : null,
      color: resourceId ? resourceId.toString() : null,
    };
    this.vertices.set(vertex.id, vertex);
    if (!this.adjacency.has(vertex.id)) {
      this.adjacency.set(vertex.id, new Set());
    }
    return vertex;
  }

  addEdge(id1, id2) {
    const v1 = id1.toString();
    const v2 = id2.toString();
    if (v1 === v2) return;
    if (this.adjacency.has(v1) && this.adjacency.has(v2)) {
      this.adjacency.get(v1).add(v2);
      this.adjacency.get(v2).add(v1);
    }
  }

  buildIntervalEdges() {
    const list = Array.from(this.vertices.values());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (intervalsOverlap(list[i], list[j])) {
          this.addEdge(list[i].id, list[j].id);
        }
      }
    }
  }

  getAdjacentColors(vertexId) {
    const neighbors = this.adjacency.get(vertexId.toString()) || new Set();
    const usedColors = new Set();
    for (const neighborId of neighbors) {
      const neighbor = this.vertices.get(neighborId);
      if (neighbor && neighbor.color) {
        usedColors.add(neighbor.color);
      }
    }
    return usedColors;
  }

  /**
   * Deterministic greedy coloring for a candidate vertex against an eligible resource palette.
   */
  colorCandidate(candidateId, eligiblePalette = [], { attendeeCount } = {}) {
    const candidate = this.vertices.get(candidateId.toString());
    if (!candidate) return null;

    const forbiddenColors = this.getAdjacentColors(candidateId);

    for (const resource of eligiblePalette) {
      const resourceIdStr = (resource._id || resource.id).toString();
      if (!forbiddenColors.has(resourceIdStr)) {
        candidate.color = resourceIdStr;
        candidate.resourceId = resourceIdStr;

        const count =
          attendeeCount !== undefined &&
          attendeeCount !== null &&
          attendeeCount !== ""
            ? Number(attendeeCount)
            : null;

        const reason =
          count && count > 0
            ? `${resource.name} is active, fits ${count} attendees, and has no overlapping booking.`
            : `${resource.name} is active and has no overlapping booking.`;

        return {
          allocatedResource: formatSafeResourceSummary(resource),
          allocationReason: reason,
        };
      }
    }

    return null;
  }
}

/**
 * Fetches active, matching resources sorted deterministically.
 */
export async function fetchEligibleResources({
  resourceType,
  attendeeCount,
  ResourceModel = Resource,
} = {}) {
  const query = { isActive: true };

  if (resourceType) {
    query.type = resourceType;
  }

  if (
    attendeeCount !== undefined &&
    attendeeCount !== null &&
    attendeeCount !== ""
  ) {
    const count = Number(attendeeCount);
    if (Number.isInteger(count) && count >= 1) {
      query.capacity = { $gte: count };
    }
  }

  let queryBuilder = ResourceModel.find(query);
  if (typeof queryBuilder.lean === "function") {
    queryBuilder = queryBuilder.lean();
  }
  const resources = await queryBuilder;
  return sortPaletteDeterministically(resources);
}

/**
 * Fetches existing events with an assigned resource that overlap the search window.
 * Strictly projects resource, startAt, endAt for complete privacy.
 */
export async function fetchOverlappingResourceBookings({
  windowStart,
  windowEnd,
  excludeEventId,
  EventModel = Event,
} = {}) {
  const query = {
    resource: { $ne: null },
    status: { $ne: "cancelled" },
    startAt: { $lt: windowEnd },
    endAt: { $gt: windowStart },
  };

  if (excludeEventId) {
    query._id = { $ne: excludeEventId };
  }

  let queryBuilder = EventModel.find(query);
  if (typeof queryBuilder.select === "function") {
    queryBuilder = queryBuilder.select("resource startAt endAt");
  }
  if (typeof queryBuilder.lean === "function") {
    queryBuilder = queryBuilder.lean();
  }

  return await queryBuilder;
}

/**
 * Runs Graph Coloring allocation for a single candidate slot.
 */
export function allocateResourceForCandidateSlot({
  candidateSlot,
  candidateId = "candidate",
  overlappingEvents = [],
  eligiblePalette = [],
  attendeeCount,
}) {
  const slotStart =
    candidateSlot.startAt instanceof Date
      ? candidateSlot.startAt
      : new Date(candidateSlot.startAt);
  const slotEnd =
    candidateSlot.endAt instanceof Date
      ? candidateSlot.endAt
      : new Date(candidateSlot.endAt);

  const relevantEvents = overlappingEvents.filter((event) =>
    intervalsOverlap({ startAt: slotStart, endAt: slotEnd }, event),
  );

  const graph = new ResourceConflictGraph();
  graph.addVertex({
    id: candidateId,
    startAt: slotStart,
    endAt: slotEnd,
    isCandidate: true,
  });

  for (let idx = 0; idx < relevantEvents.length; idx++) {
    const ev = relevantEvents[idx];
    const resId = ev.resource?._id || ev.resource;
    if (resId) {
      graph.addVertex({
        id: (ev._id || ev.id || `event-${idx}`).toString(),
        startAt: ev.startAt,
        endAt: ev.endAt,
        resourceId: resId.toString(),
        isCandidate: false,
      });
    }
  }

  graph.buildIntervalEdges();

  return graph.colorCandidate(candidateId, eligiblePalette, { attendeeCount });
}

