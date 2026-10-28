import test from "node:test";
import assert from "node:assert/strict";
import { mergeIntervals } from "../workspace/solution.js";

function reference(intervals) {
  if (intervals.length === 0) return [];
  const sorted = intervals.map(([start, end]) => [start, end]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result = [sorted[0].slice()];
  for (let index = 1; index < sorted.length; index += 1) {
    const last = result[result.length - 1];
    const [start, end] = sorted[index];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      result.push([start, end]);
    }
  }
  return result;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("handles empty and single intervals", () => {
  assert.deepEqual(mergeIntervals([]), []);
  assert.deepEqual(mergeIntervals([[-3, -1]]), [[-3, -1]]);
});

test("handles nested, duplicate, and negative intervals", () => {
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3], [4, 8]]), [[1, 10]]);
  assert.deepEqual(mergeIntervals([[2, 2], [2, 2], [3, 4]]), [[2, 2], [3, 4]]);
  assert.deepEqual(mergeIntervals([[-5, -1], [-3, 2], [0, 4]]), [[-5, 4]]);
});

test("returns sorted output for unsorted input", () => {
  assert.deepEqual(mergeIntervals([[10, 12], [1, 2], [3, 4], [5, 9]]), [[1, 2], [3, 4], [5, 9], [10, 12]]);
});

test("matches the reference on seeded random inputs", () => {
  const next = random(20261028);
  for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
    const count = Math.floor(next() * 30);
    const intervals = Array.from({ length: count }, () => {
      const start = Math.floor(next() * 100) - 50;
      const end = start + Math.floor(next() * 10);
      return [start, end];
    });
    assert.deepEqual(mergeIntervals(intervals), reference(intervals), `case ${caseIndex}`);
  }
});
