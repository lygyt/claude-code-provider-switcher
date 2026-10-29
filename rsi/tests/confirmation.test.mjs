import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTask } from "../src/task.mjs";
import { runTask } from "../src/loop.mjs";
import { ScriptedProposer } from "../src/proposers.mjs";
import { readText, removeDir } from "../src/util.mjs";

const baselineSolution = [
  "export const COST = 100;",
  "export function solve() {",
  "  return COST;",
  "}",
  ""
].join("\n");

const candidateSolution = [
  "export const COST = 10;",
  "export function solve() {",
  "  return COST;",
  "}",
  ""
].join("\n");

const solutionTest = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { solve } from "../workspace/solution.js";',
  "",
  'test("solve is positive", () => {',
  "  assert.ok(solve() > 0);",
  "});",
  ""
].join("\n");

async function writeSyntheticTask(root, callsFile, slowAfterCall, targetMs) {
  const taskDir = path.join(root, "task");
  const files = {
    "task.json": JSON.stringify(
      {
        id: "synthetic/confirm",
        title: "Confirmation fixture",
        category: "synthetic",
        prompt: "prompt.md",
        workspace: "workspace",
        editable: ["solution.js"],
        publicTestsDir: "tests",
        hiddenTestsDir: "hidden",
        testCommand: ["node", "--test", "--test-reporter=tap", "tests/public.test.mjs"],
        hiddenCommand: ["node", "--test", "--test-reporter=tap", "hidden.test.mjs"],
        benchmarkFile: "bench.mjs",
        benchmark: {
          command: ["node", "bench.mjs"],
          targetMs,
          maxMs: 1000,
          runs: 5,
          timeoutMs: 5000
        },
        timeoutMs: 30000,
        weights: { correctness: 0.7, performance: 0.2, quality: 0.1 }
      },
      null,
      2
    ),
    "prompt.md": "# Synthetic task\n\nReturn a positive number.\n",
    "workspace/solution.js": baselineSolution,
    "tests/public.test.mjs": solutionTest,
    "hidden/hidden.test.mjs": solutionTest,
    "bench.mjs": [
      'import { appendFileSync, readFileSync, existsSync } from "node:fs";',
      'import { COST } from "./workspace/solution.js";',
      `const callsFile = ${JSON.stringify(callsFile)};`,
      'const count = existsSync(callsFile) ? readFileSync(callsFile, "utf8").split("\\n").filter(Boolean).length : 0;',
      'appendFileSync(callsFile, "run\\n");',
      `const ms = count >= ${slowAfterCall} && COST < 50 ? COST * 20 : COST;`,
      'console.log(JSON.stringify({ ms }));',
      ""
    ].join("\n")
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(taskDir, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return loadTask(taskDir);
}

async function runFixture({
  slowAfterCall = 1_000_000_000,
  targetMs = 100,
  candidate = candidateSolution,
  maxIterations = 1
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-confirm-"));
  const callsFile = path.join(root, "benchmark-calls.log");
  try {
    const task = await writeSyntheticTask(root, callsFile, slowAfterCall, targetMs);
    const proposer = new ScriptedProposer(
      Array.from({ length: maxIterations }, () => ({
        files: { "solution.js": candidate },
        rationale: "Synthetic candidate.",
        lessons: []
      }))
    );
    const result = await runTask(task, {
      proposer,
      maxIterations,
      optimizePerformance: true
    });
    return {
      result,
      calls: (await readText(callsFile)).trim().split("\n").length,
      requests: proposer.requests
    };
  } finally {
    await removeDir(root);
  }
}

test("runTask confirms a performance win before replacing the best", async () => {
  const { result, calls } = await runFixture();

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].accepted, true);
  assert.equal(result.history[0].reason, "performance");
  assert.equal(result.best.benchMs, 10);
  assert.equal(result.best.benchmarkComparison.pairedWins, 6);
  assert.equal(result.best.hiddenResult.passed, 1);

  // One baseline measurement (5 runs) plus two interleaved comparisons with
  // six rounds per side (12 runs each).
  assert.equal(calls, 5 + 12 + 12);
});

test("runTask confirms a benchmark-driven score acceptance", async () => {
  // The baseline already meets the performance target, so the score gain can
  // only come from the benchmark component. The acceptance reason stays
  // "score", but it must still reproduce in a second comparison.
  const { result, calls } = await runFixture({ targetMs: 50 });

  assert.equal(result.history[0].accepted, true);
  assert.equal(result.history[0].reason, "score");
  assert.equal(result.best.benchMs, 10);
  assert.equal(calls, 5 + 12 + 12);
});

test("runTask rejects a speedup that does not reproduce", async () => {
  // Calls 0-4 are the baseline, 5-16 the first comparison, and 17+ the
  // confirmation. The candidate is ten times cheaper until the confirmation.
  const { result, calls } = await runFixture({ slowAfterCall: 17 });

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].accepted, false);
  assert.equal(result.history[0].reason, "rejected");
  assert.equal(result.best.benchMs, 100);
  assert.equal(calls, 5 + 12 + 12);
});

test("runTask feeds the latest interleaved reference into the next proposal", async () => {
  // A slower but correct candidate is rejected, yet its comparison measured
  // the current best on this machine. The next prompt should use that fresh
  // 100ms reference instead of assuming the accepted median is still current.
  const slowerSolution = baselineSolution.replace("COST = 100", "COST = 200");
  const { result, calls, requests } = await runFixture({
    candidate: slowerSolution,
    maxIterations: 2
  });

  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].accepted, false);
  assert.equal(result.best.benchMs, 100);
  assert.equal(calls, 5 + 12 + 12);
  assert.match(
    requests[1].prompt,
    /Latest interleaved check: the current best measured 100ms median over 6 alternating rounds/
  );
  assert.match(requests[1].prompt, /The last candidate measured 200ms\./);
  assert.match(requests[1].prompt, /at least 5% and 0\.5ms faster/);
});
