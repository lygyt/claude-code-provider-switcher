import test from "node:test";
import assert from "node:assert/strict";
import { maxFlow } from "../workspace/solution.js";

test("computes a small maximum flow", () => {
  const edges = [
    [0, 1, 3],
    [0, 2, 2],
    [1, 2, 5],
    [1, 3, 2],
    [2, 3, 3]
  ];
  assert.equal(maxFlow(4, edges, 0, 3), 5);
});

test("handles parallel edges", () => {
  const edges = [
    [0, 1, 2],
    [0, 1, 3],
    [1, 2, 4]
  ];
  assert.equal(maxFlow(3, edges, 0, 2), 4);
});

test("returns zero when source equals sink", () => {
  assert.equal(maxFlow(3, [[0, 1, 7]], 1, 1), 0);
});

test("returns zero when the sink is unreachable", () => {
  assert.equal(maxFlow(4, [[0, 1, 5], [2, 3, 5]], 0, 3), 0);
});

test("ignores zero-capacity edges and self-loops", () => {
  const edges = [
    [0, 0, 10],
    [0, 1, 0],
    [0, 2, 4],
    [2, 2, 9],
    [2, 3, 4]
  ];
  assert.equal(maxFlow(4, edges, 0, 3), 4);
});

test("does not mutate the input edges", () => {
  const edges = [
    [0, 1, 5],
    [1, 2, 5]
  ];
  const copy = edges.map((edge) => [...edge]);
  maxFlow(3, edges, 0, 2);
  assert.deepEqual(edges, copy);
});
