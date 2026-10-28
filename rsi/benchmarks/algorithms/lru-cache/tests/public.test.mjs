import test from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../workspace/solution.js";

test("evicts the least recently used key", () => {
  const cache = new LRUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  assert.equal(cache.get(1), 1);
  cache.put(3, 3);
  assert.equal(cache.get(2), -1);
  assert.equal(cache.get(1), 1);
  assert.equal(cache.get(3), 3);
});

test("updates an existing key and refreshes recency", () => {
  const cache = new LRUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  cache.put(1, 10);
  cache.put(3, 3);
  assert.equal(cache.get(2), -1);
  assert.equal(cache.get(1), 10);
});

test("handles capacity one", () => {
  const cache = new LRUCache(1);
  cache.put(1, -5);
  assert.equal(cache.get(1), -5);
  cache.put(2, 0);
  assert.equal(cache.get(1), -1);
  assert.equal(cache.get(2), 0);
});
