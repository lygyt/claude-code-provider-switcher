import test from "node:test";
import assert from "node:assert/strict";
import { maxSlidingWindow } from "../workspace/solution.js";

function reference(nums, k) {
  const result = [];
  for (let start = 0; start + k <= nums.length; start += 1) {
    let maximum = nums[start];
    for (let index = start + 1; index < start + k; index += 1) {
      if (nums[index] > maximum) {
        maximum = nums[index];
      }
    }
    result.push(maximum);
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

test("single element and full-window cases", () => {
  assert.deepEqual(maxSlidingWindow([7], 1), [7]);
  assert.deepEqual(maxSlidingWindow([1, 2, 3, 4], 4), [4]);
});

test("matches brute force on seeded random arrays", () => {
  const next = random(31337);
  for (let round = 0; round < 300; round += 1) {
    const length = 1 + Math.floor(next() * 80);
    const nums = Array.from({ length }, () => Math.floor(next() * 2001) - 1000);
    const k = 1 + Math.floor(next() * length);
    assert.deepEqual(maxSlidingWindow(nums, k), reference(nums, k), `round ${round} k=${k}`);
  }
});

test("matches brute force when values repeat heavily", () => {
  const next = random(999);
  for (let round = 0; round < 100; round += 1) {
    const length = 1 + Math.floor(next() * 60);
    const nums = Array.from({ length }, () => Math.floor(next() * 5));
    const k = 1 + Math.floor(next() * length);
    assert.deepEqual(maxSlidingWindow(nums, k), reference(nums, k), `round ${round} k=${k}`);
  }
});
