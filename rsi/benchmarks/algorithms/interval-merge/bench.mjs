import { mergeIntervals } from "./workspace/solution.js";

let state = 123456789;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const intervals = Array.from({ length: 100000 }, () => {
  const start = Math.floor(next() * 1000000);
  return [start, start + Math.floor(next() * 1000)];
});

const started = performance.now();
const result = mergeIntervals(intervals);
const elapsed = performance.now() - started;
if (!Array.isArray(result)) {
  throw new Error("mergeIntervals did not return an array");
}
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), count: result.length }));
