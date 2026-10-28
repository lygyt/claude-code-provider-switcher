import test from "node:test";
import assert from "node:assert/strict";
import { maxFlow } from "../workspace/solution.js";

function referenceMaxFlow(n, edges, source, sink) {
  if (source === sink) return 0;

  const graph = Array.from({ length: n }, () => []);
  const addEdge = (from, to, capacity) => {
    const forward = { to, capacity, reverse: graph[to].length };
    const backward = { to: from, capacity: 0, reverse: graph[from].length };
    graph[from].push(forward);
    graph[to].push(backward);
  };
  for (const [from, to, capacity] of edges) {
    if (from !== to) addEdge(from, to, capacity);
  }

  let total = 0;
  while (true) {
    const parentVertex = new Array(n).fill(-1);
    const parentEdge = new Array(n).fill(-1);
    parentVertex[source] = source;
    const queue = [source];
    for (let head = 0; head < queue.length && parentVertex[sink] === -1; head += 1) {
      const vertex = queue[head];
      for (let index = 0; index < graph[vertex].length; index += 1) {
        const edge = graph[vertex][index];
        if (edge.capacity > 0 && parentVertex[edge.to] === -1) {
          parentVertex[edge.to] = vertex;
          parentEdge[edge.to] = index;
          if (edge.to === sink) break;
          queue.push(edge.to);
        }
      }
    }
    if (parentVertex[sink] === -1) break;

    let bottleneck = Infinity;
    for (let vertex = sink; vertex !== source; vertex = parentVertex[vertex]) {
      bottleneck = Math.min(bottleneck, graph[parentVertex[vertex]][parentEdge[vertex]].capacity);
    }
    for (let vertex = sink; vertex !== source; vertex = parentVertex[vertex]) {
      const previous = parentVertex[vertex];
      const edge = graph[previous][parentEdge[vertex]];
      edge.capacity -= bottleneck;
      graph[vertex][edge.reverse].capacity += bottleneck;
    }
    total += bottleneck;
  }
  return total;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("matches an independent Edmonds-Karp reference on seeded random graphs", () => {
  const next = random(31415926);
  for (let round = 0; round < 250; round += 1) {
    const n = 2 + Math.floor(next() * 7);
    const edgeCount = Math.floor(next() * 13);
    const edges = [];
    for (let index = 0; index < edgeCount; index += 1) {
      const from = Math.floor(next() * n);
      const to = Math.floor(next() * n);
      const capacity = Math.floor(next() * 6);
      edges.push([from, to, capacity]);
    }
    const source = Math.floor(next() * n);
    const sink = Math.floor(next() * n);
    assert.equal(
      maxFlow(n, edges, source, sink),
      referenceMaxFlow(n, edges, source, sink),
      `round ${round} n=${n} source=${source} sink=${sink}`
    );
  }
});

test("matches the classic CLRS network", () => {
  const edges = [
    [0, 1, 16],
    [0, 2, 13],
    [1, 2, 10],
    [2, 1, 4],
    [1, 3, 12],
    [3, 2, 9],
    [2, 4, 14],
    [4, 3, 7],
    [3, 5, 20],
    [4, 5, 4]
  ];
  assert.equal(maxFlow(6, edges, 0, 5), 23);
});

test("saturates a layered bipartite network", () => {
  const left = 5;
  const right = 4;
  const source = 0;
  const sink = 1 + left + right;
  const edges = [];
  for (let index = 0; index < left; index += 1) {
    edges.push([source, 1 + index, 1]);
  }
  for (let l = 0; l < left; l += 1) {
    for (let r = 0; r < right; r += 1) {
      edges.push([1 + l, 1 + left + r, 1]);
    }
  }
  for (let index = 0; index < right; index += 1) {
    edges.push([1 + left + index, sink, 1]);
  }
  assert.equal(maxFlow(sink + 1, edges, source, sink), 4);
});

test("handles zero capacities, self-loops, and no path", () => {
  assert.equal(maxFlow(3, [[0, 1, 0], [1, 2, 0]], 0, 2), 0);
  assert.equal(maxFlow(3, [[0, 0, 10], [1, 1, 10]], 0, 2), 0);
  assert.equal(maxFlow(4, [[0, 1, 5], [1, 2, 5]], 0, 3), 0);
});
