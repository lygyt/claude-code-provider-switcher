import test from "node:test";
import assert from "node:assert/strict";
import { countPatterns } from "../workspace/solution.js";

function naive(text, patterns) {
  return patterns.map((pattern) => {
    let count = 0;
    for (let start = 0; start + pattern.length <= text.length; start += 1) {
      let matched = true;
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (text[start + offset] !== pattern[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) count += 1;
    }
    return count;
  });
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("matches a naive reference on seeded random inputs", () => {
  const next = random(777001);
  for (let round = 0; round < 250; round += 1) {
    const textLength = Math.floor(next() * 35);
    let text = "";
    for (let index = 0; index < textLength; index += 1) {
      text += next() < 0.5 ? "a" : "b";
    }

    const patternCount = Math.floor(next() * 7);
    const patterns = [];
    for (let index = 0; index < patternCount; index += 1) {
      const patternLength = 1 + Math.floor(next() * 5);
      let pattern = "";
      for (let offset = 0; offset < patternLength; offset += 1) {
        pattern += next() < 0.5 ? "a" : "b";
      }
      patterns.push(pattern);
    }

    assert.deepEqual(countPatterns(text, patterns), naive(text, patterns), `round ${round}`);
  }
});

test("pattern prefixes and suffixes all match independently", () => {
  assert.deepEqual(countPatterns("abcabcabc", ["abc", "bca", "cab", "abcabc", "c"]), [3, 2, 2, 2, 3]);
  assert.deepEqual(countPatterns("aaaaaaaa", ["a", "aa", "aaa", "b"]), [8, 7, 6, 0]);
  assert.deepEqual(countPatterns("ab", ["ba", "ab", "aba"]), [0, 1, 0]);
});

test("a pattern that is a suffix of another is counted through failure links", () => {
  assert.deepEqual(countPatterns("she sells seashells", ["he", "she", "shell", "shells", "ells"]), [2, 2, 1, 1, 2]);
});
