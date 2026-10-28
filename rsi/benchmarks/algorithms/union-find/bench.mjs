import { UnionFind } from "./workspace/solution.js";

const n = 100000;
const sets = new UnionFind(n);
let checksum = 0;
const started = performance.now();

for (let index = 0; index + 1 < n; index += 1) {
  sets.union(index, index + 1);
}

for (let index = 0; index < n; index += 1) {
  if (sets.connected(0, index)) {
    checksum += 1;
  }
}

const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
