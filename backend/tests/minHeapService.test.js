import test from "node:test";
import assert from "node:assert/strict";
import { MinHeap } from "../src/services/scheduling/minHeapService.js";

test("MinHeap: pops smallest numbers in ascending order", () => {
  const heap = new MinHeap();
  const values = [42, 10, 5, 30, 2, 8, 15];

  for (const v of values) {
    heap.push(v);
  }

  assert.equal(heap.size(), 7);
  assert.equal(heap.peek(), 2);

  const sorted = [];
  while (heap.size() > 0) {
    sorted.push(heap.pop());
  }

  assert.deepEqual(sorted, [2, 5, 8, 10, 15, 30, 42]);
  assert.equal(heap.size(), 0);
  assert.equal(heap.pop(), null);
  assert.equal(heap.peek(), null);
});

test("MinHeap: supports custom comparator for priority ranking (e.g. higher score first)", () => {
  const priorityHeap = new MinHeap((a, b) => b.score - a.score);

  priorityHeap.push({ id: 1, score: 60 });
  priorityHeap.push({ id: 2, score: 95 });
  priorityHeap.push({ id: 3, score: 75 });
  priorityHeap.push({ id: 4, score: 100 });
  priorityHeap.push({ id: 5, score: 40 });

  assert.equal(priorityHeap.size(), 5);
  assert.equal(priorityHeap.peek().score, 100);

  const ranked = [];
  while (priorityHeap.size() > 0) {
    ranked.push(priorityHeap.pop().score);
  }

  assert.deepEqual(ranked, [100, 95, 75, 60, 40]);
});

test("MinHeap: handles single item correctly", () => {
  const heap = new MinHeap();
  heap.push(99);

  assert.equal(heap.size(), 1);
  assert.equal(heap.peek(), 99);
  assert.equal(heap.pop(), 99);
  assert.equal(heap.size(), 0);
  assert.equal(heap.pop(), null);
});

test("MinHeap: handles empty heap safely", () => {
  const heap = new MinHeap();

  assert.equal(heap.size(), 0);
  assert.equal(heap.peek(), null);
  assert.equal(heap.pop(), null);
});
