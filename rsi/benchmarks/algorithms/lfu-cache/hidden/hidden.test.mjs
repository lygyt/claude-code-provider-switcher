import test from "node:test";
import assert from "node:assert/strict";
import { LFUCache } from "../workspace/solution.js";

class ReferenceLFU {
  constructor(capacity) {
    this.capacity = capacity;
    this.entries = new Map();
    this.clock = 0;
  }

  use(entry) {
    entry.frequency += 1;
    entry.lastUsed = ++this.clock;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return -1;
    this.use(entry);
    return entry.value;
  }

  put(key, value) {
    if (this.capacity === 0) return;
    const existing = this.entries.get(key);
    if (existing) {
      existing.value = value;
      this.use(existing);
      return;
    }
    if (this.entries.size >= this.capacity) {
      let victimKey;
      let victim;
      for (const [candidateKey, candidate] of this.entries) {
        if (
          victim === undefined ||
          candidate.frequency < victim.frequency ||
          (candidate.frequency === victim.frequency && candidate.lastUsed < victim.lastUsed)
        ) {
          victimKey = candidateKey;
          victim = candidate;
        }
      }
      this.entries.delete(victimKey);
    }
    this.entries.set(key, { value, frequency: 1, lastUsed: ++this.clock });
  }
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("matches a reference LFU implementation on seeded mixed operations", () => {
  const next = random(20240607);
  for (let round = 0; round < 80; round += 1) {
    const capacity = Math.floor(next() * 7);
    const actual = new LFUCache(capacity);
    const expected = new ReferenceLFU(capacity);
    for (let step = 0; step < 250; step += 1) {
      const key = Math.floor(next() * 10);
      if (next() < 0.55) {
        const value = Math.floor(next() * 1000);
        actual.put(key, value);
        expected.put(key, value);
      } else {
        assert.equal(actual.get(key), expected.get(key), `round ${round} step ${step} key ${key}`);
      }
    }
    for (let key = 0; key < 10; key += 1) {
      assert.equal(actual.get(key), expected.get(key), `final round ${round} key ${key}`);
    }
  }
});

test("frequency dominates recency across several eviction waves", () => {
  const cache = new LFUCache(3);
  cache.put(1, 1);
  cache.put(2, 2);
  cache.put(3, 3);
  cache.get(1);
  cache.get(1);
  cache.get(2);
  cache.put(4, 4);
  assert.equal(cache.get(3), -1);
  assert.equal(cache.get(4), 4);
  cache.put(5, 5);
  assert.equal(cache.get(2), -1);
  assert.equal(cache.get(5), 5);
  cache.get(1);
  cache.put(6, 6);
  assert.equal(cache.get(4), -1);
  assert.equal(cache.get(6), 6);
  assert.equal(cache.get(5), 5);
  assert.equal(cache.get(1), 1);
});

test("updating a key on every put keeps it resident", () => {
  const cache = new LFUCache(2);
  cache.put(1, 0);
  cache.put(2, 0);
  for (let value = 1; value <= 200; value += 1) {
    cache.put(1, value);
    cache.put(3, value);
    assert.equal(cache.get(1), value);
  }
  assert.equal(cache.get(2), -1);
});
