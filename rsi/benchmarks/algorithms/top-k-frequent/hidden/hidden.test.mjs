import test from "node:test";
import assert from "node:assert/strict";
import { topKFrequent } from "../workspace/solution.js";

function reference(nums, k) {
  const counts = new Map();
  for (const value of nums) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, k)
    .map(([value]) => value);
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("handles negative values and single elements", () => {
  assert.deepEqual(topKFrequent([-5], 1), [-5]);
  assert.deepEqual(topKFrequent([0, 0, -1, -1, -1], 1), [-1]);
});

test("matches a reference implementation on seeded random arrays", () => {
  const next = random(20261028);
  for (let round = 0; round < 100; round += 1) {
    const length = 1 + Math.floor(next() * 120);
    const nums = Array.from({ length }, () => Math.floor(next() * 25) - 12);
    const distinct = new Set(nums).size;
    const k = 1 + Math.floor(next() * distinct);
    assert.deepEqual(topKFrequent(nums, k), reference(nums, k), `round ${round}`);
  }
});
