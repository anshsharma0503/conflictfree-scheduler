import test from "node:test";
import assert from "node:assert/strict";
import { SegmentTree } from "../src/services/scheduling/segmentTreeService.js";

test("SegmentTree throws on missing windowStart", () => {
  assert.throws(
    () =>
      new SegmentTree({
        windowEnd: "2026-08-25T17:00:00.000Z",
        stepMinutes: 30,
      }),
    /windowStart is required/,
  );
});

test("SegmentTree throws on missing windowEnd", () => {
  assert.throws(
    () =>
      new SegmentTree({
        windowStart: "2026-08-25T09:00:00.000Z",
        stepMinutes: 30,
      }),
    /windowEnd is required/,
  );
});

test("SegmentTree throws on windowEnd <= windowStart", () => {
  assert.throws(
    () =>
      new SegmentTree({
        windowStart: "2026-08-25T17:00:00.000Z",
        windowEnd: "2026-08-25T09:00:00.000Z",
        stepMinutes: 30,
      }),
    /windowEnd must be after windowStart/,
  );

  assert.throws(
    () =>
      new SegmentTree({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T09:00:00.000Z",
        stepMinutes: 30,
      }),
    /windowEnd must be after windowStart/,
  );
});

test("SegmentTree throws on invalid stepMinutes", () => {
  assert.throws(
    () =>
      new SegmentTree({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        stepMinutes: 0,
      }),
    /stepMinutes must be a positive number/,
  );

  assert.throws(
    () =>
      new SegmentTree({
        windowStart: "2026-08-25T09:00:00.000Z",
        windowEnd: "2026-08-25T17:00:00.000Z",
        stepMinutes: -15,
      }),
    /stepMinutes must be a positive number/,
  );
});

test("SegmentTree reports all slots free when no busy ranges added", () => {
  const tree = new SegmentTree({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    stepMinutes: 30,
  });

  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T10:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    tree.isRangeFree({
      startAt: "2026-08-25T13:00:00.000Z",
      endAt: "2026-08-25T15:00:00.000Z",
    }),
    true,
  );
  assert.deepEqual(tree.getCoveredIndexes(), []);
});

test("SegmentTree marks single busy range and reports overlap correctly", () => {
  const tree = new SegmentTree({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    stepMinutes: 30,
  });

  tree.addBusyRange({
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
  });

  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T10:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T10:30:00.000Z",
      end: "2026-08-25T11:30:00.000Z",
    }),
    false,
  );
  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T09:30:00.000Z",
      end: "2026-08-25T10:30:00.000Z",
    }),
    false,
  );
  assert.deepEqual(tree.getCoveredIndexes(), [2, 3]);
});

test("SegmentTree marks multiple non-overlapping busy ranges", () => {
  const tree = new SegmentTree({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    stepMinutes: 30,
  });

  tree.addBusyRange({
    start: "2026-08-25T09:30:00.000Z",
    end: "2026-08-25T10:30:00.000Z",
  });
  tree.addBusyRange({
    start: "2026-08-25T14:00:00.000Z",
    end: "2026-08-25T15:00:00.000Z",
  });

  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T09:30:00.000Z",
    }),
    true,
  );
  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T10:00:00.000Z",
      end: "2026-08-25T11:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T11:00:00.000Z",
      end: "2026-08-25T13:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T14:30:00.000Z",
      end: "2026-08-25T15:30:00.000Z",
    }),
    false,
  );
  assert.deepEqual(tree.getCoveredIndexes(), [1, 2, 10, 11]);
});

test("SegmentTree handles back-to-back boundaries correctly (slot starting when busy ends = free)", () => {
  const tree = new SegmentTree({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    stepMinutes: 30,
  });

  tree.addBusyRange({
    startAt: "2026-08-25T10:00:00.000Z",
    endAt: "2026-08-25T11:00:00.000Z",
  });

  assert.equal(
    tree.isRangeFree({
      startAt: "2026-08-25T09:00:00.000Z",
      endAt: "2026-08-25T10:00:00.000Z",
    }),
    true,
  );

  assert.equal(
    tree.isRangeFree({
      startAt: "2026-08-25T11:00:00.000Z",
      endAt: "2026-08-25T12:00:00.000Z",
    }),
    true,
  );
});

test("SegmentTree clamps busy ranges outside the window without throwing", () => {
  const tree = new SegmentTree({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    stepMinutes: 30,
  });

  assert.doesNotThrow(() => {
    tree.addBusyRange({
      start: "2026-08-25T07:00:00.000Z",
      end: "2026-08-25T08:00:00.000Z",
    });
  });

  assert.doesNotThrow(() => {
    tree.addBusyRange({
      start: "2026-08-25T18:00:00.000Z",
      end: "2026-08-25T19:00:00.000Z",
    });
  });

  assert.doesNotThrow(() => {
    tree.addBusyRange({
      start: "2026-08-25T08:00:00.000Z",
      end: "2026-08-25T10:00:00.000Z",
    });
  });

  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T09:00:00.000Z",
      end: "2026-08-25T10:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    tree.isRangeFree({
      start: "2026-08-25T10:00:00.000Z",
      end: "2026-08-25T11:00:00.000Z",
    }),
    true,
  );
  assert.deepEqual(tree.getCoveredIndexes(), [0, 1]);
});

test("SegmentTree throws on query range outside the window", () => {
  const tree = new SegmentTree({
    windowStart: "2026-08-25T09:00:00.000Z",
    windowEnd: "2026-08-25T17:00:00.000Z",
    stepMinutes: 30,
  });

  assert.throws(
    () =>
      tree.isRangeFree({
        start: "2026-08-25T07:00:00.000Z",
        end: "2026-08-25T08:00:00.000Z",
      }),
    /Query range is out of the segment tree window/,
  );

  assert.throws(
    () =>
      tree.isRangeFree({
        start: "2026-08-25T18:00:00.000Z",
        end: "2026-08-25T19:00:00.000Z",
      }),
    /Query range is out of the segment tree window/,
  );
});
