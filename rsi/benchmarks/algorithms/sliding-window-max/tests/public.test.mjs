import test from "node:test";
import assert from "node:assert/strict";
import { maxSlidingWindow } from "../workspace/solution.js";

test("returns the maximum for each window", () => {
  assert.deepEqual(maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3), [3, 3, 5, 5, 6, 7]);
});

test("supports k equal to one and k equal to the array length", () => {
  assert.deepEqual(maxSlidingWindow([4, -2, 7], 1), [4, -2, 7]);
  assert.deepEqual(maxSlidingWindow([4, -2, 7], 3), [7]);
});

test("handles duplicates and all-negative input", () => {
  assert.deepEqual(maxSlidingWindow([-5, -5, -2, -2, -9], 2), [-5, -2, -2, -2]);
});

test("does not mutate the input", () => {
  const input = [2, 1, 3, 2];
  const copy = [...input];
  maxSlidingWindow(input, 2);
  assert.deepEqual(input, copy);
});
