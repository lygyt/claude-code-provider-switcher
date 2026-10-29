import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTask } from "../src/task.mjs";
import {
  buildEvaluationEnv,
  evaluateTask,
  parseTap,
  runCommand,
  staticCheck,
  summarizeEvaluation
} from "../src/evaluator.mjs";
import { readCurrentEditable } from "../src/workspace.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");
const taskDir = path.join(rsiRoot, "benchmarks", "algorithms", "interval-merge");

test("parseTap reads a TAP summary and failing test names", () => {
  const output = [
    "TAP version 13",
    "ok 1 - first",
    "not ok 2 - second",
    "  ---",
    "  error: boom",
    "  ...",
    "# tests 2",
    "# pass 1",
    "# fail 1"
  ].join("\n");
  const result = parseTap(output);
  assert.equal(result.parsed, true);
  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failures, ["second"]);
});

test("parseTap falls back to ok/not ok lines", () => {
  const result = parseTap("ok 1 - a\nnot ok 2 - b\nok 3 - c\n");
  assert.equal(result.total, 3);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failures, ["b"]);
  assert.equal(parseTap("nothing useful").parsed, false);
});

test("staticCheck rejects forbidden capabilities and reduces quality", async () => {
  const task = await loadTask(taskDir);
  const files = {
    "solution.js": "import fs from 'node:fs';\nexport function mergeIntervals(x) { return fs.readFileSync('x'); }\n"
  };
  const result = staticCheck(task, files);
  assert.ok(result.violations.some((violation) => /filesystem/.test(violation)));
  assert.equal(result.quality, 0.75);

  const clean = staticCheck(task, { "solution.js": referenceSolutions[task.id]["solution.js"] });
  assert.deepEqual(clean.violations, []);
  assert.equal(clean.quality, 1);
});

test("buildEvaluationEnv strips API credentials", () => {
  const saved = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN
  };
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_AUTH_TOKEN = "test-token";
  try {
    const env = buildEvaluationEnv();
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.ok(env.PATH || env.Path);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("runCommand captures output and kills timed-out processes", async () => {
  const ok = await runCommand([process.execPath, "-e", "console.log('hello')"], { timeoutMs: 5000 });
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /hello/);
  assert.equal(ok.timedOut, false);

  const slow = await runCommand([process.execPath, "-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.code, -1);
  assert.ok(slow.durationMs < 8000, `took ${slow.durationMs}ms`);
});

test("evaluateTask refuses to execute a proposal with policy violations", async () => {
  const task = await loadTask(taskDir);
  const result = await evaluateTask(task, {
    files: {
      "solution.js": "import { readFileSync } from 'node:fs';\nexport function mergeIntervals() { return readFileSync('x'); }\n"
    },
    measureBenchmark: false
  });
  assert.match(result.error, /Static policy check/);
  assert.deepEqual(result.violations, ["solution.js: filesystem access"]);
  assert.equal(result.hiddenResult.total, 0);
  assert.equal(result.publicResult.total, 0);
});

test("evaluateTask scores a weak baseline below a correct reference", async () => {
  const task = await loadTask(taskDir);
  const baseline = await evaluateTask(task, {
    files: await readCurrentEditable(task),
    measureBenchmark: false
  });
  const reference = await evaluateTask(task, {
    files: referenceSolutions[task.id],
    measureBenchmark: false
  });

  assert.equal(baseline.hiddenResult.passed, 2);
  assert.equal(baseline.hiddenResult.total, 4);
  assert.equal(reference.hiddenResult.passed, 4);
  assert.equal(reference.hiddenResult.total, 4);
  assert.ok(reference.score > baseline.score);
  assert.equal(reference.quality, 1);
  assert.deepEqual(summarizeEvaluation(reference).violations, []);
});

test("evaluateTask measures benchmark performance", async () => {
  const task = await loadTask(path.join(rsiRoot, "benchmarks", "algorithms", "top-k-frequent"));
  const result = await evaluateTask(task, { files: referenceSolutions[task.id] });
  assert.equal(result.hiddenResult.passed, 2);
  assert.equal(result.hiddenResult.total, 2);
  assert.equal(result.performance, 1);
  assert.ok(result.benchMs > 0);
  assert.ok(Math.abs(result.score - 1) < 1e-9);
});

test("evaluateTask can override the number of benchmark runs", async () => {
  const task = await loadTask(path.join(rsiRoot, "benchmarks", "algorithms", "top-k-frequent"));
  const result = await evaluateTask(task, {
    files: referenceSolutions[task.id],
    benchmarkRuns: 3
  });
  assert.equal(result.benchmarkRuns.length, 3);
  assert.equal(result.performance, 1);
});

test("evaluateTask interleaves candidate and reference benchmark rounds", async () => {
  const task = await loadTask(path.join(rsiRoot, "benchmarks", "algorithms", "top-k-frequent"));
  const files = referenceSolutions[task.id];
  const result = await evaluateTask(task, {
    files,
    compareFiles: files,
    benchmarkRuns: 3
  });

  // Three requested runs round up to four alternating rounds per side.
  assert.equal(result.benchmarkRuns.length, 4);
  assert.equal(result.benchmarkComparison.runs.length, 4);
  assert.equal(result.benchmarkComparison.pairedRounds, 4);
  assert.ok(result.benchmarkComparison.pairedWins >= 0);
  assert.ok(result.benchmarkComparison.pairedWins <= 4);
  assert.ok(Number.isFinite(result.benchmarkComparison.pairedRatio));
  assert.ok(Number.isFinite(result.benchmarkComparison.pairedDeltaMs));
  assert.ok(result.benchMs > 0);
  assert.ok(result.benchmarkComparison.benchMs > 0);
  assert.equal(result.performance, 1);
  assert.equal(result.benchmarkComparison.score, 1);
  assert.ok(Math.abs(result.score - 1) < 1e-9);
  assert.equal(summarizeEvaluation(result).referenceRuns, 4);
});
