import { shortestPaths } from "./workspace/solution.js";

let state = 271828;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const n = 20000;
const edges = [];

// Adversarial Bellman-Ford order: the chain relaxes one hop per full pass.
for (let vertex = n - 2; vertex >= 0; vertex -= 1) {
  edges.push([vertex, vertex + 1, 1]);
}

// Add enough high-weight edges to reach 100,000 without creating shortcuts.
while (edges.length < 100000) {
  const u = Math.floor(next() * n);
  const v = Math.floor(next() * n);
  edges.push([u, v, 1000000 + Math.floor(next() * 1000000)]);
}

const started = performance.now();
const result = shortestPaths(n, edges, 0);
let checksum = 0;
for (let vertex = 0; vertex < n; vertex += 97) {
  checksum += result[vertex];
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
