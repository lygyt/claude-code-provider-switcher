import { topKFrequent } from "./workspace/solution.js";

let state = 13579;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const nums = Array.from({ length: 50000 }, () => Math.floor(next() * 2000) - 1000);
const started = performance.now();
let checksum = 0;
for (let repeat = 0; repeat < 2; repeat += 1) {
  const result = topKFrequent(nums, 10);
  checksum += result.reduce((sum, value) => sum + value, 0);
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
