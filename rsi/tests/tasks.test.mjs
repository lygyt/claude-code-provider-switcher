import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTasks } from "../src/task.mjs";
import { evaluateTask } from "../src/evaluator.mjs";
import { readCurrentEditable } from "../src/workspace.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";
import { pathExists } from "../src/util.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");
const benchmarksRoot = path.join(rsiRoot, "benchmarks");

test("every benchmark task has a complete, internally consistent definition", async () => {
  const tasks = await listTasks(benchmarksRoot);
  assert.equal(tasks.length, 8);
  for (const task of tasks) {
    assert.ok(task.prompt.length > 100, `${task.id} prompt is too short`);
    assert.ok(task.editable.length > 0);
    assert.ok(await pathExists(task.workspaceDir), `${task.id} workspace missing`);
    assert.ok(await pathExists(task.publicTestsDir), `${task.id} public tests missing`);
    assert.ok(await pathExists(task.hiddenTestsDir), `${task.id} hidden tests missing`);
    assert.ok(task.benchmark, `${task.id} benchmark missing`);
    assert.ok(referenceSolutions[task.id], `${task.id} reference solution missing`);
    for (const relative of task.editable) {
      assert.ok(await pathExists(path.join(task.workspaceDir, relative)), `${task.id} baseline ${relative} missing`);
    }
  }
});

test("reference solutions pass every hidden test", async () => {
  for (const task of await listTasks(benchmarksRoot)) {
    const result = await evaluateTask(task, {
      files: referenceSolutions[task.id],
      measureBenchmark: false
    });
    assert.equal(result.error, undefined, `${task.id}: ${result.error}`);
    assert.equal(result.hiddenResult.total > 0, true, `${task.id} has no hidden tests`);
    assert.equal(
      result.hiddenResult.passed,
      result.hiddenResult.total,
      `${task.id} hidden failures: ${result.hiddenResult.failures.join("; ")}`
    );
    assert.equal(result.publicResult.failed, 0, `${task.id} public failures`);
    assert.equal(result.quality, 1, `${task.id} policy violations: ${result.violations.join("; ")}`);
    assert.ok(result.score >= 0.8, `${task.id} reference score ${result.score}`);
  }
});

test("the interval-merge baseline fails hidden tests while optimization baselines stay correct", async () => {
  const tasks = await listTasks(benchmarksRoot);
  const expected = {
    "algorithms/interval-merge": { hiddenPassed: 2, hiddenTotal: 4 },
    "algorithms/lru-cache": { hiddenPassed: 3, hiddenTotal: 3 },
    "algorithms/top-k-frequent": { hiddenPassed: 2, hiddenTotal: 2 },
    "algorithms/edit-distance": { hiddenPassed: 2, hiddenTotal: 2 },
    "algorithms/sliding-window-max": { hiddenPassed: 3, hiddenTotal: 3 },
    "algorithms/union-find": { hiddenPassed: 3, hiddenTotal: 3 },
    "algorithms/median-stream": { hiddenPassed: 2, hiddenTotal: 2 },
    "algorithms/dijkstra": { hiddenPassed: 2, hiddenTotal: 2 }
  };

  for (const task of tasks) {
    const baseline = await evaluateTask(task, {
      files: await readCurrentEditable(task),
      measureBenchmark: false
    });
    assert.equal(baseline.hiddenResult.passed, expected[task.id].hiddenPassed, task.id);
    assert.equal(baseline.hiddenResult.total, expected[task.id].hiddenTotal, task.id);
  }
});
