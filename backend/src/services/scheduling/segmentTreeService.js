export class SegmentTree {
  constructor({ windowStart, windowEnd, stepMinutes }) {
    if (!windowStart) {
      throw new Error("windowStart is required");
    }

    if (!windowEnd) {
      throw new Error("windowEnd is required");
    }

    const start = new Date(windowStart);
    const end = new Date(windowEnd);

    if (isNaN(start.getTime())) {
      throw new Error("windowStart must be a valid date");
    }

    if (isNaN(end.getTime())) {
      throw new Error("windowEnd must be a valid date");
    }

    if (end <= start) {
      throw new Error("windowEnd must be after windowStart");
    }

    if (
      stepMinutes === undefined ||
      stepMinutes === null ||
      stepMinutes === "" ||
      !Number.isFinite(Number(stepMinutes)) ||
      Number(stepMinutes) <= 0
    ) {
      throw new Error("stepMinutes must be a positive number");
    }

    this.windowStart = start;
    this.windowEnd = end;
    this.stepMinutes = Number(stepMinutes);
    this.stepMs = this.stepMinutes * 60 * 1000;
    this.size = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / this.stepMs),
    );
    this.tree = new Array(Math.max(1, 4 * this.size))
      .fill(null)
      .map(() => ({ isBusy: false }));
  }

  updateRange(node, l, r, ql, qr) {
    if (l === r) {
      this.tree[node].isBusy = true;
      return;
    }

    const mid = Math.floor((l + r) / 2);
    if (ql <= mid) {
      this.updateRange(2 * node, l, mid, ql, qr);
    }
    if (qr > mid) {
      this.updateRange(2 * node + 1, mid + 1, r, ql, qr);
    }

    const leftBusy = this.tree[2 * node]?.isBusy || false;
    const rightBusy = this.tree[2 * node + 1]?.isBusy || false;
    this.tree[node].isBusy = leftBusy || rightBusy;
  }

  queryFree(node, l, r, ql, qr) {
    if (ql <= l && r <= qr) {
      return !this.tree[node].isBusy;
    }

    const mid = Math.floor((l + r) / 2);
    let isFree = true;

    if (ql <= mid) {
      isFree = isFree && this.queryFree(2 * node, l, mid, ql, qr);
    }
    if (qr > mid && isFree) {
      isFree = isFree && this.queryFree(2 * node + 1, mid + 1, r, ql, qr);
    }

    return isFree;
  }

  addBusyRange(range = {}) {
    const rawStart = range.startAt ?? range.start;
    const rawEnd = range.endAt ?? range.end;

    if (!rawStart || !rawEnd) {
      throw new Error("start and end are required");
    }

    const start = new Date(rawStart);
    const end = new Date(rawEnd);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("start and end must be valid dates");
    }

    const windowStartMs = this.windowStart.getTime();
    const windowEndMs = this.windowEnd.getTime();
    const startMs = start.getTime();
    const endMs = end.getTime();

    if (endMs <= windowStartMs || startMs >= windowEndMs || endMs <= startMs) {
      return;
    }

    const clampedStart = Math.max(startMs, windowStartMs);
    const clampedEnd = Math.min(endMs, windowEndMs);

    const startIdx = Math.floor((clampedStart - windowStartMs) / this.stepMs);
    const endIdx = Math.ceil((clampedEnd - windowStartMs) / this.stepMs) - 1;

    if (startIdx > endIdx) {
      return;
    }

    const boundedStart = Math.max(0, Math.min(this.size - 1, startIdx));
    const boundedEnd = Math.max(0, Math.min(this.size - 1, endIdx));

    this.updateRange(1, 0, this.size - 1, boundedStart, boundedEnd);
  }

  isRangeFree(range = {}) {
    const rawStart = range.startAt ?? range.start;
    const rawEnd = range.endAt ?? range.end;

    if (!rawStart || !rawEnd) {
      throw new Error("start and end are required");
    }

    const start = new Date(rawStart);
    const end = new Date(rawEnd);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("start and end must be valid dates");
    }

    const windowStartMs = this.windowStart.getTime();
    const windowEndMs = this.windowEnd.getTime();
    const startMs = start.getTime();
    const endMs = end.getTime();

    if (endMs <= windowStartMs || startMs >= windowEndMs) {
      throw new Error("Query range is out of the segment tree window");
    }

    if (endMs <= startMs) {
      return true;
    }

    const clampedStart = Math.max(startMs, windowStartMs);
    const clampedEnd = Math.min(endMs, windowEndMs);

    const startIdx = Math.floor((clampedStart - windowStartMs) / this.stepMs);
    const endIdx = Math.ceil((clampedEnd - windowStartMs) / this.stepMs) - 1;

    if (startIdx > endIdx) {
      return true;
    }

    const boundedStart = Math.max(0, Math.min(this.size - 1, startIdx));
    const boundedEnd = Math.max(0, Math.min(this.size - 1, endIdx));

    return this.queryFree(1, 0, this.size - 1, boundedStart, boundedEnd);
  }

  getCoveredIndexes() {
    const indexes = [];
    const traverse = (node, l, r) => {
      if (!this.tree[node]?.isBusy) {
        return;
      }
      if (l === r) {
        indexes.push(l);
        return;
      }
      const mid = Math.floor((l + r) / 2);
      traverse(2 * node, l, mid);
      traverse(2 * node + 1, mid + 1, r);
    };

    traverse(1, 0, this.size - 1);
    return indexes;
  }
}
