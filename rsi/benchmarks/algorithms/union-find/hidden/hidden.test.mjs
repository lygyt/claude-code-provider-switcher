import test from "node:test";
import assert from "node:assert/strict";
import { UnionFind } from "../workspace/solution.js";

class Reference {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, index) => index);
    this.rank = new Array(n).fill(0);
  }

  find(x) {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) {
      [rootA, rootB] = [rootB, rootA];
    }
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) {
      this.rank[rootA] += 1;
    }
  }

  connected(a, b) {
    return this.find(a) === this.find(b);
  }
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("supports a single element and singleton unions", () => {
  const sets = new UnionFind(1);
  assert.equal(sets.connected(0, 0), true);
  sets.union(0, 0);
  assert.equal(sets.connected(0, 0), true);
});

test("matches a reference disjoint-set implementation", () => {
  const next = random(515151);
  for (let round = 0; round < 60; round += 1) {
    const n = 1 + Math.floor(next() * 60);
    const actual = new UnionFind(n);
    const expected = new Reference(n);
    for (let step = 0; step < 400; step += 1) {
      const a = Math.floor(next() * n);
      const b = Math.floor(next() * n);
      if (next() < 0.55) {
        actual.union(a, b);
        expected.union(a, b);
      } else {
        assert.equal(actual.connected(a, b), expected.connected(a, b), `round ${round} step ${step}`);
        assert.equal(actual.find(a) === actual.find(b), expected.connected(a, b));
      }
    }
  }
});

test("handles long chains without losing connectivity", () => {
  const n = 500;
  const sets = new UnionFind(n);
  for (let index = 0; index + 1 < n; index += 1) {
    sets.union(index, index + 1);
  }
  for (let index = 0; index < n; index += 1) {
    assert.equal(sets.connected(0, index), true);
  }
  assert.equal(sets.connected(n - 1, 0), true);
});
