import test from "node:test";
import assert from "node:assert/strict";
import { countPatterns } from "../workspace/solution.js";

test("counts each pattern occurrence", () => {
  assert.deepEqual(countPatterns("the cat sat on the mat", ["cat", "the", "dog"]), [1, 2, 0]);
});

test("counts overlapping occurrences", () => {
  assert.deepEqual(countPatterns("aaaa", ["a", "aa", "aaa", "aaaa"]), [4, 3, 2, 1]);
});

test("duplicate patterns get identical counts", () => {
  assert.deepEqual(countPatterns("abab", ["ab", "ab", "b"]), [2, 2, 2]);
});

test("handles an empty pattern list", () => {
  assert.deepEqual(countPatterns("anything", []), []);
});

test("handles patterns longer than the text", () => {
  assert.deepEqual(countPatterns("abc", ["abcd", "a"]), [0, 1]);
});
