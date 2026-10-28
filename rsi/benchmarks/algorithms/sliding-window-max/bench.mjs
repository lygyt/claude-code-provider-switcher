import { maxSlidingWindow } from "./workspace/solution.js";

let state = 424242;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const nums = Array.from({ length: 300000 }, () => Math.floor(next() * 2000001) - 1000000);
const started = performance.now();
let checksum = 0;
for (let repeat = 0; repeat < 2; repeat += 1) {
  const result = maxSlidingWindow(nums, 1500);
  for (let index = 0; index < result.length; index += 97) {
    checksum += result[index];
  }
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
