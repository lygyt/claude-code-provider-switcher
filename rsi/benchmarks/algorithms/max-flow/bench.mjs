import { maxFlow } from "./workspace/solution.js";

const paths = 4000;
const decoyLeft = 200;
const decoyRight = 400;
const source = 0;
const sink = 1;
const firstPath = 2;
const firstDecoy = firstPath + paths;
const firstLeaf = firstDecoy + decoyLeft;
const n = firstLeaf + decoyRight;

const edges = [];

// Dead-end decoys are deliberately placed first so a breadth-first search that
// does not use a level graph re-scans them on every augmentation.
for (let left = 0; left < decoyLeft; left += 1) {
  const decoy = firstDecoy + left;
  edges.push([source, decoy, 1000000000]);
  for (let right = 0; right < decoyRight; right += 1) {
    edges.push([decoy, firstLeaf + right, 1000000000]);
  }
}

for (let index = 0; index < paths; index += 1) {
  const vertex = firstPath + index;
  edges.push([source, vertex, 1]);
  edges.push([vertex, sink, 1]);
}

const started = performance.now();
let checksum = 0;
for (let repeat = 0; repeat < 2; repeat += 1) {
  checksum += maxFlow(n, edges, source, sink);
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
