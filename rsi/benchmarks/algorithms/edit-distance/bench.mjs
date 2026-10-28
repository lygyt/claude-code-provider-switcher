import { editDistance } from "./workspace/solution.js";

let state = 24681357;
const next = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};

const alphabet = "abcdefghijklmnopqrstuvwxyz";
const makeString = () => Array.from({ length: 120 }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
const pairs = Array.from({ length: 200 }, () => [makeString(), makeString()]);

const started = performance.now();
let checksum = 0;
for (const [a, b] of pairs) {
  checksum += editDistance(a, b);
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
