import test from "node:test";
import assert from "node:assert/strict";
import { shortestPaths } from "../workspace/solution.js";

test("computes simple shortest paths", () => {
  const edges = [
    [0, 1, 4],
    [0, 2, 1],
    [2, 1, 2],
    [1, 3, 1]
  ];
  assert.deepEqual(shortestPaths(4, edges, 0), [0, 3, 1, 4]);
});

test("marks unreachable vertices with -1", () => {
  assert.deepEqual(shortestPaths(4, [[0, 1, 5]], 0), [0, 5, -1, -1]);
});

test("handles zero-weight edges, duplicates, and self-loops", () => {
  const edges = [
    [0, 1, 5],
    [0, 1, 2],
    [0, 0, 0],
    [1, 2, 0],
    [2, 2, 0]
  ];
  assert.deepEqual(shortestPaths(3, edges, 0), [0, 2, 2]);
});

test("source with no outgoing edges", () => {
  assert.deepEqual(shortestPaths(3, [], 1), [-1, 0, -1]);
});
