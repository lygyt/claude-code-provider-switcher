import test from "node:test";
import assert from "node:assert/strict";
import { topKFrequent } from "../workspace/solution.js";

test("returns the k most frequent values", () => {
  assert.deepEqual(topKFrequent([1, 1, 1, 2, 2, 3], 2), [1, 2]);
});

test("breaks frequency ties by smaller value", () => {
  assert.deepEqual(topKFrequent([4, 4, 1, 1, 2], 2), [1, 4]);
  assert.deepEqual(topKFrequent([5, 3, 5, 3, -1, -1], 3), [-1, 3, 5]);
});

test("supports k equal to the number of distinct values", () => {
  assert.deepEqual(topKFrequent([7, 7, 2, -3], 3), [7, -3, 2]);
});

test("does not mutate the input", () => {
  const input = [3, 1, 3, 2, 1, 3];
  const copy = [...input];
  topKFrequent(input, 2);
  assert.deepEqual(input, copy);
});
