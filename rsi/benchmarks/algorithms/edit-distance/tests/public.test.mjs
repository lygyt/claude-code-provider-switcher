import test from "node:test";
import assert from "node:assert/strict";
import { editDistance } from "../workspace/solution.js";

test("classic example", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
});

test("empty strings", () => {
  assert.equal(editDistance("", ""), 0);
  assert.equal(editDistance("abc", ""), 3);
  assert.equal(editDistance("", "abcd"), 4);
});

test("identical strings", () => {
  assert.equal(editDistance("algorithm", "algorithm"), 0);
});

test("substitution versus insertion and deletion", () => {
  assert.equal(editDistance("flaw", "lawn"), 2);
  assert.equal(editDistance("gumbo", "gambol"), 2);
});

test("case sensitivity", () => {
  assert.equal(editDistance("Abc", "abc"), 1);
});
