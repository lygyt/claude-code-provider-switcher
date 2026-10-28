import test from "node:test";
import assert from "node:assert/strict";
import { isMatch } from "../workspace/solution.js";

test("matches literal characters exactly", () => {
  assert.equal(isMatch("abc", "abc"), true);
  assert.equal(isMatch("abc", "abd"), false);
  assert.equal(isMatch("abc", "ab"), false);
  assert.equal(isMatch("ab", "abc"), false);
});

test("dot matches exactly one character", () => {
  assert.equal(isMatch("abc", "a.c"), true);
  assert.equal(isMatch("ac", "a.c"), false);
  assert.equal(isMatch("abcd", "a.c"), false);
});

test("star matches zero or more copies", () => {
  assert.equal(isMatch("aa", "a*"), true);
  assert.equal(isMatch("", "a*"), true);
  assert.equal(isMatch("b", "a*b"), true);
  assert.equal(isMatch("aaab", "a*b"), true);
  assert.equal(isMatch("aaac", "a*b"), false);
});

test("dot star matches everything", () => {
  assert.equal(isMatch("", ".*"), true);
  assert.equal(isMatch("anything at all", ".*"), true);
});

test("empty text and empty pattern", () => {
  assert.equal(isMatch("", ""), true);
  assert.equal(isMatch("a", ""), false);
  assert.equal(isMatch("", "a"), false);
  assert.equal(isMatch("", "a*b*c*"), true);
});
