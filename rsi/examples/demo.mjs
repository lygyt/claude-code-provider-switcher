import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTasks } from "../src/task.mjs";
import { runSuite } from "../src/loop.mjs";
import { ScriptedProposer } from "../src/proposers.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const benchmarksRoot = path.resolve(moduleDir, "..", "benchmarks");

function round(value) {
  return Number(Number(value).toFixed(4));
}

const tasks = await listTasks(benchmarksRoot);
const suite = await runSuite(tasks, {
  proposerFactory: async (task) =>
    new ScriptedProposer([
      {
        files: referenceSolutions[task.id],
        rationale: "Scripted reference solution.",
        lessons: []
      }
    ]),
  maxIterations: 1,
  minDelta: 0.01,
  targetScore: 0.98
});

console.log("Scripted-oracle demo: this validates the evaluation loop end to end.");
console.log("It is not a measurement of model self-improvement.\n");
console.log("task\tbaseline\tbest\tdelta\thidden");
for (const result of suite.results) {
  console.log(
    `${result.task.id}\t${round(result.baseline.score)}\t${round(result.best.score)}\t${round(
      result.best.score - result.baseline.score
    )}\t${result.best.hiddenResult.passed}/${result.best.hiddenResult.total}`
  );
}
console.log(`\nmean best score ${round(suite.aggregate.meanScore)}`);
console.log(`solved ${suite.aggregate.solved}/${suite.aggregate.tasks}; improved ${suite.aggregate.improved}/${suite.aggregate.tasks}`);

const interval = suite.results.find((result) => result.task.id === "algorithms/interval-merge");
if (interval) {
  console.log("\n--- interval-merge report ---\n");
  console.log(interval.report);
}

const everyHiddenTestPassed = suite.results.every(
  (result) => result.best.hiddenResult.passed === result.best.hiddenResult.total
);
if (!everyHiddenTestPassed) {
  process.exitCode = 1;
}
