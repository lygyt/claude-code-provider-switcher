import { isMatch } from "./workspace/solution.js";

const text = "a".repeat(60);
const pattern = "a*".repeat(10) + "b";

const started = performance.now();
let checksum = 0;
for (let repeat = 0; repeat < 2; repeat += 1) {
  checksum += isMatch(text, pattern) ? 1 : 0;
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
