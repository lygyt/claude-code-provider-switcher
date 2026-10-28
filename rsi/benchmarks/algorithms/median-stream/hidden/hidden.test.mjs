import test from "node:test";
import assert from "node:assert/strict";
import { MedianFinder } from "../workspace/solution.js";

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("matches a reference median after every insertion", () => {
  const next = random(8675309);
  for (let round = 0; round < 40; round += 1) {
    const finder = new MedianFinder();
    const values = [];
    const count = 1 + Math.floor(next() * 150);
    for (let step = 0; step < count; step += 1) {
      const value = Math.floor(next() * 1001) - 500;
      finder.addNum(value);
      values.push(value);
      assert.equal(finder.findMedian(), median(values), `round ${round} step ${step}`);
    }
  }
});

test("handles a large constant stream and alternating extremes", () => {
  const finder = new MedianFinder();
  finder.addNum(5);
  for (let index = 0; index < 1000; index += 1) {
    finder.addNum(5);
  }
  assert.equal(finder.findMedian(), 5);

  const extremes = new MedianFinder();
  for (let index = 0; index < 500; index += 1) {
    extremes.addNum(-1000000 - index);
    extremes.addNum(1000000 + index);
  }
  assert.equal(extremes.findMedian(), 0);
});
