import { LFUCache } from "./workspace/solution.js";

let state = 987654321;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const operations = [];
for (let index = 0; index < 100000; index += 1) {
  const key = Math.floor(next() * 25000);
  if (next() < 0.6) {
    operations.push([0, key, Math.floor(next() * 1000000)]);
  } else {
    operations.push([1, key, 0]);
  }
}

const cache = new LFUCache(8000);
let checksum = 0;
const started = performance.now();
for (const [kind, key, value] of operations) {
  if (kind === 0) {
    cache.put(key, value);
  } else {
    checksum += cache.get(key);
  }
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
