import test from "node:test";
import assert from "node:assert/strict";
import { shortestPaths } from "../workspace/solution.js";

function reference(n, edges, source) {
  const weights = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (const [u, v, weight] of edges) {
    if (weight < weights[u][v]) {
      weights[u][v] = weight;
    }
  }

  const dist = new Array(n).fill(Infinity);
  const visited = new Array(n).fill(false);
  dist[source] = 0;
  for (let step = 0; step < n; step += 1) {
    let current = -1;
    for (let vertex = 0; vertex < n; vertex += 1) {
      if (!visited[vertex] && dist[vertex] !== Infinity && (current === -1 || dist[vertex] < dist[current])) {
        current = vertex;
      }
    }
    if (current === -1) break;
    visited[current] = true;
    for (let vertex = 0; vertex < n; vertex += 1) {
      const next = dist[current] + weights[current][vertex];
      if (next < dist[vertex]) {
        dist[vertex] = next;
      }
    }
  }
  return dist.map((value) => (value === Infinity ? -1 : value));
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("matches a reference Dijkstra on seeded random graphs", () => {
  const next = random(1618033);
  for (let round = 0; round < 80; round += 1) {
    const n = 1 + Math.floor(next() * 30);
    const edgeCount = Math.floor(next() * 100);
    const edges = [];
    for (let index = 0; index < edgeCount; index += 1) {
      const u = Math.floor(next() * n);
      const v = Math.floor(next() * n);
      const weight = Math.floor(next() * 10);
      edges.push([u, v, weight]);
    }
    const source = Math.floor(next() * n);
    assert.deepEqual(shortestPaths(n, edges, source), reference(n, edges, source), `round ${round}`);
  }
});

test("long chain and distant unreachable component", () => {
  const n = 400;
  const edges = [];
  for (let index = 0; index + 1 < n / 2; index += 1) {
    edges.push([index, index + 1, 2]);
  }
  for (let index = n / 2; index + 1 < n; index += 1) {
    edges.push([index, index + 1, 1]);
  }
  const result = shortestPaths(n, edges, 0);
  assert.equal(result[0], 0);
  assert.equal(result[n / 2 - 1], n - 2);
  assert.equal(result[n / 2], -1);
  assert.equal(result[n - 1], -1);
});
