import { LRUCache } from "./workspace/solution.js";

let state = 987654321;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const cache = new LRUCache(4000);
const started = performance.now();
let checksum = 0;
for (let index = 0; index < 200000; index += 1) {
  const key = Math.floor(next() * 20000);
  if (next() < 0.5) {
    checksum += cache.get(key);
  } else {
    cache.put(key, index);
  }
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
