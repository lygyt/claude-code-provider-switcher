import test from "node:test";
import assert from "node:assert/strict";
import { mergeIntervals } from "../workspace/solution.js";

test("merges a sorted overlapping list", () => {
  assert.deepEqual(
    mergeIntervals([[1, 3], [2, 6], [8, 10], [15, 18]]),
    [[1, 6], [8, 10], [15, 18]]
  );
});

test("merges touching intervals", () => {
  assert.deepEqual(mergeIntervals([[1, 4], [4, 5]]), [[1, 5]]);
});

test("sorts an unsorted list before merging", () => {
  assert.deepEqual(mergeIntervals([[5, 7], [1, 3], [2, 4]]), [[1, 4], [5, 7]]);
});

test("does not mutate the input", () => {
  const input = [[1, 5], [2, 3]];
  const snapshot = JSON.stringify(input);
  mergeIntervals(input);
  assert.equal(JSON.stringify(input), snapshot);
});
