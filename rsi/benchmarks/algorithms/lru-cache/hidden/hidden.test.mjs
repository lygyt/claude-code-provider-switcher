import test from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../workspace/solution.js";

class ReferenceCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return -1;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value);
    }
  }
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("missing keys do not change recency", () => {
  const cache = new LRUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  assert.equal(cache.get(99), -1);
  cache.put(3, 3);
  assert.equal(cache.get(1), -1);
  assert.equal(cache.get(2), 2);
});

test("updating a key does not grow the cache", () => {
  const cache = new LRUCache(2);
  cache.put(1, 1);
  cache.put(2, 2);
  cache.put(2, 20);
  cache.put(1, 10);
  assert.equal(cache.get(1), 10);
  assert.equal(cache.get(2), 20);
});

test("matches a reference implementation on seeded random operations", () => {
  const next = random(424242);
  for (let round = 0; round < 20; round += 1) {
    const capacity = 1 + Math.floor(next() * 8);
    const actual = new LRUCache(capacity);
    const expected = new ReferenceCache(capacity);
    for (let step = 0; step < 500; step += 1) {
      const key = Math.floor(next() * 20);
      if (next() < 0.5) {
        assert.equal(actual.get(key), expected.get(key), `round ${round} step ${step} get ${key}`);
      } else {
        const value = Math.floor(next() * 200) - 100;
        actual.put(key, value);
        expected.put(key, value);
      }
    }
  }
});
