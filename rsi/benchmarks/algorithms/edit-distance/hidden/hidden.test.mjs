import test from "node:test";
import assert from "node:assert/strict";
import { editDistance } from "../workspace/solution.js";

function reference(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }
  return previous[b.length];
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const alphabet = "abcde";

test("single character cases", () => {
  assert.equal(editDistance("a", "a"), 0);
  assert.equal(editDistance("a", "b"), 1);
  assert.equal(editDistance("a", "ab"), 1);
});

test("matches a reference dynamic program on seeded random strings", () => {
  const next = random(777001);
  for (let round = 0; round < 200; round += 1) {
    const lengthA = Math.floor(next() * 6);
    const lengthB = Math.floor(next() * 6);
    const a = Array.from({ length: lengthA }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
    const b = Array.from({ length: lengthB }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
    assert.equal(editDistance(a, b), reference(a, b), `round ${round}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
});
