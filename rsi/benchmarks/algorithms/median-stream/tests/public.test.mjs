import test from "node:test";
import assert from "node:assert/strict";
import { MedianFinder } from "../workspace/solution.js";

test("tracks odd and even medians", () => {
  const finder = new MedianFinder();
  finder.addNum(1);
  assert.equal(finder.findMedian(), 1);
  finder.addNum(2);
  assert.equal(finder.findMedian(), 1.5);
  finder.addNum(3);
  assert.equal(finder.findMedian(), 2);
});

test("handles duplicates and negative values", () => {
  const finder = new MedianFinder();
  for (const value of [-5, -5, 0, 2]) {
    finder.addNum(value);
  }
  assert.equal(finder.findMedian(), -2.5);
  finder.addNum(100);
  assert.equal(finder.findMedian(), 0);
});

test("order of insertion does not matter", () => {
  const a = new MedianFinder();
  const b = new MedianFinder();
  for (const value of [7, 1, 9, 3]) a.addNum(value);
  for (const value of [3, 9, 1, 7]) b.addNum(value);
  assert.equal(a.findMedian(), b.findMedian());
});
