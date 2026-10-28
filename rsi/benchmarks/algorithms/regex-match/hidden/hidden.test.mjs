import test from "node:test";
import assert from "node:assert/strict";
import { isMatch } from "../workspace/solution.js";

function oracle(text, pattern) {
  return new RegExp(`^(?:${pattern})$`).test(text);
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("handles the classic overlapping-star cases", () => {
  const cases = [
    ["aa", "a", false],
    ["aa", "a*", true],
    ["ab", ".*", true],
    ["aab", "c*a*b", true],
    ["mississippi", "mis*is*p*.", false],
    ["ab", ".*c", false],
    ["aaa", "a*a", true],
    ["aaa", "ab*a*c*a", true],
    ["a", "ab*", true],
    ["bbbba", ".*a*a", true]
  ];
  for (const [text, pattern, expected] of cases) {
    assert.equal(isMatch(text, pattern), expected, `${text} / ${pattern}`);
  }
});

test("matches an independent regular-expression oracle on seeded random inputs", () => {
  const next = random(42424242);
  const letters = ["a", "b"];
  for (let round = 0; round < 250; round += 1) {
    const textLength = Math.floor(next() * 11);
    let text = "";
    for (let index = 0; index < textLength; index += 1) {
      text += letters[Math.floor(next() * letters.length)];
    }

    const atoms = [];
    const atomCount = Math.floor(next() * 7);
    for (let index = 0; index < atomCount; index += 1) {
      const atom = ["a", "b", "."][Math.floor(next() * 3)];
      atoms.push(next() < 0.45 ? `${atom}*` : atom);
    }
    const pattern = atoms.join("");

    assert.equal(isMatch(text, pattern), oracle(text, pattern), `round ${round}: ${text} / ${pattern}`);
  }
});

test("star-heavy patterns do not change the answer", () => {
  assert.equal(isMatch("aaaaaaaaaa", "a*a*a*a*a*a*a*a*a*a*"), true);
  assert.equal(isMatch("aaaaaaaaaa", "a*a*a*a*a*a*a*a*a*a*b"), false);
  assert.equal(isMatch("ababab", "a*b*a*b*a*b*"), true);
  assert.equal(isMatch("xyz", ".*.*.*"), true);
});
