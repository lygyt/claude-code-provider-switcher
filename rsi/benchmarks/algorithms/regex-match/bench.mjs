import { isMatch } from "./workspace/solution.js";

// Keep the workload above timer resolution: a rolling DP needs roughly
// text.length * pattern-token-count cell updates. At 20k characters and 101
// tokens the reference DP takes tens of milliseconds, while the exponential
// baseline cannot finish a single run.
const text = "a".repeat(20000);
const pattern = "a*".repeat(100) + "b";

const started = performance.now();
let checksum = 0;
for (let repeat = 0; repeat < 2; repeat += 1) {
  checksum += isMatch(text, pattern) ? 1 : 0;
}
const elapsed = performance.now() - started;
console.log(JSON.stringify({ ms: Number(elapsed.toFixed(2)), checksum }));
