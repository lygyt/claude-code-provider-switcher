import { MedianFinder } from "./workspace/solution.js";

let state = 11235813;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const finder = new MedianFinder();
const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100000; index += 1) {
  finder.addNum(Math.floor(next() * 2000001) - 1000000);
  checksum += finder.findMedian();
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum: Number(checksum.toFixed(2)) }));
