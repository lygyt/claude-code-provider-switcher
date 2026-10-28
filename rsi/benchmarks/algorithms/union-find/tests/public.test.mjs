import test from "node:test";
import assert from "node:assert/strict";
import { UnionFind } from "../workspace/solution.js";

test("elements start disconnected", () => {
  const sets = new UnionFind(5);
  assert.equal(sets.connected(0, 1), false);
  assert.equal(sets.connected(3, 3), true);
  assert.equal(sets.find(2), sets.find(2));
});

test("union merges sets and is idempotent", () => {
  const sets = new UnionFind(6);
  sets.union(0, 1);
  sets.union(1, 2);
  assert.equal(sets.connected(0, 2), true);
  assert.equal(sets.connected(0, 3), false);
  sets.union(0, 2);
  assert.equal(sets.connected(0, 2), true);
  assert.equal(sets.connected(3, 5), false);
  sets.union(3, 5);
  assert.equal(sets.connected(3, 5), true);
});

test("find is consistent with connected after many merges", () => {
  const n = 30;
  const sets = new UnionFind(n);
  for (let index = 1; index < n; index += 2) {
    sets.union(index - 1, index);
  }
  for (let left = 0; left < n; left += 1) {
    for (let right = 0; right < n; right += 1) {
      assert.equal(sets.connected(left, right), sets.find(left) === sets.find(right));
    }
  }
});
