import test from "node:test";
import assert from "node:assert/strict";
import { LFUCache } from "../workspace/solution.js";

test("evicts the least frequently used key", () => {
  const cache = new LFUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  cache.get(1);
  cache.put(3, 3);
  assert.equal(cache.get(2), -1);
  assert.equal(cache.get(3), 3);
  assert.equal(cache.get(1), 1);
});

test("breaks frequency ties by recency", () => {
  const cache = new LFUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  cache.get(1);
  cache.get(2);
  cache.put(3, 3);
  assert.equal(cache.get(1), -1);
  assert.equal(cache.get(2), 2);
  assert.equal(cache.get(3), 3);
});

test("updating an existing key counts as a use", () => {
  const cache = new LFUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  cache.put(1, 10);
  cache.put(3, 3);
  assert.equal(cache.get(2), -1);
  assert.equal(cache.get(1), 10);
  assert.equal(cache.get(3), 3);
});

test("capacity zero stores nothing", () => {
  const cache = new LFUCache(0);
  cache.put(1, 1);
  assert.equal(cache.get(1), -1);
});

test("capacity one replaces on every new key", () => {
  const cache = new LFUCache(1);
  cache.put(1, 1);
  assert.equal(cache.get(1), 1);
  cache.put(2, 2);
  assert.equal(cache.get(1), -1);
  assert.equal(cache.get(2), 2);
});
