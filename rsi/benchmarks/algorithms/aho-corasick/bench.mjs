import { countPatterns } from "./workspace/solution.js";

let state = 1357911;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

let text = "";
for (let index = 0; index < 200000; index += 1) {
  text += next() < 0.5 ? "a" : "b";
}

const patterns = [];
for (let index = 0; index < 1000; index += 1) {
  let pattern = "";
  for (let offset = 0; offset < 12; offset += 1) {
    pattern += next() < 0.5 ? "a" : "b";
  }
  patterns.push(pattern);
}

const started = performance.now();
const counts = countPatterns(text, patterns);
let checksum = 0;
for (const count of counts) {
  checksum += count;
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
