import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");
const cli = path.join(rsiRoot, "bin", "rsi.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: rsiRoot,
    encoding: "utf8",
    timeout: 120000,
    env: process.env
  });
}

test("CLI list emits machine-readable task metadata", () => {
  const result = runCli(["list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const tasks = JSON.parse(result.stdout);
  assert.deepEqual(
    tasks.map((task) => task.id),
    [
      "algorithms/aho-corasick",
      "algorithms/dijkstra",
      "algorithms/edit-distance",
      "algorithms/interval-merge",
      "algorithms/lfu-cache",
      "algorithms/lru-cache",
      "algorithms/max-flow",
      "algorithms/median-stream",
      "algorithms/regex-match",
      "algorithms/sliding-window-max",
      "algorithms/top-k-frequent",
      "algorithms/union-find"
    ]
  );
  assert.ok(tasks.every((task) => task.hasBenchmark));
});

test("CLI run accepts a scripted reference proposal", () => {
  const result = runCli([
    "run",
    "--task",
    "interval-merge",
    "--proposer",
    "reference",
    "--iterations",
    "1",
    "--no-archive",
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.task, "algorithms/interval-merge");
  assert.equal(output.best.hidden, "4/4");
  assert.ok(output.best.score > output.baseline.score);
  assert.equal(output.acceptedIterations, 1);
  assert.match(output.report, /RSI report/);
});

test("CLI rejects --apply without the explicit human gate", () => {
  const result = runCli([
    "run",
    "--task",
    "interval-merge",
    "--proposer",
    "reference",
    "--iterations",
    "1",
    "--no-archive",
    "--apply",
    "--target",
    rsiRoot
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /human-gated/);
});

test("CLI performance mode continues after the target score", () => {
  const result = runCli([
    "run",
    "--task",
    "interval-merge",
    "--proposer",
    "reference",
    "--iterations",
    "2",
    "--optimize-performance",
    "--no-archive",
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.iterations, 2);
  assert.ok(output.best.score >= 0.98);
  assert.ok(output.best.benchMs > 0);
});

test("CLI help documents the main commands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node rsi\/bin\/rsi\.mjs/);
  assert.match(result.stdout, /meta --tasks/);
  assert.match(result.stdout, /--apply --target/);
  assert.match(result.stdout, /--optimize-performance/);
  assert.match(result.stdout, /--min-speedup-ms/);
});
