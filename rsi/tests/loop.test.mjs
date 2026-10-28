import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTask, listTasks } from "../src/task.mjs";
import { runSuite, runTask } from "../src/loop.mjs";
import { ScriptedProposer } from "../src/proposers.mjs";
import { LessonStore, RunArchive } from "../src/memory.mjs";
import { readCurrentEditable } from "../src/workspace.mjs";
import { pathExists, readJsonLines, readText, removeDir } from "../src/util.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");

test("runTask rejects an unchanged proposal and accepts a real improvement", async () => {
  const task = await findTask(path.join(rsiRoot, "benchmarks"), "interval-merge");
  const baselineFiles = await readCurrentEditable(task);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-loop-"));
  try {
    const archive = new RunArchive({ root: path.join(root, "runs") });
    const lessonStore = new LessonStore({ file: path.join(root, "runs", "lessons.jsonl") });
    const proposer = new ScriptedProposer([
      {
        files: baselineFiles,
        rationale: "No change.",
        lessons: ["Unchanged code cannot improve the score."]
      },
      {
        files: referenceSolutions[task.id],
        rationale: "Sort by start, then merge overlapping intervals.",
        lessons: ["Sort intervals by start before merging for O(n log n)."]
      }
    ]);

    const result = await runTask(task, {
      proposer,
      maxIterations: 3,
      archive,
      lessonStore
    });

    assert.equal(result.history.length, 2);
    assert.equal(result.history[0].accepted, false);
    assert.equal(result.history[1].accepted, true);
    assert.equal(result.baseline.hiddenPassRate, 0.5);
    assert.equal(result.best.hiddenPassRate, 1);
    assert.ok(result.best.score > result.baseline.score + 0.1);
    assert.match(result.bestFiles["solution.js"], /\.sort\(/);

    const taskDir = path.join(root, "runs", "algorithms-interval-merge");
    assert.ok(await pathExists(path.join(taskDir, "report.md")));
    assert.ok(await pathExists(path.join(taskDir, "best", "solution.js")));
    const report = await readText(path.join(taskDir, "report.md"));
    assert.match(report, /Accepted iterations: 1\/2/);
    const lessons = await readJsonLines(path.join(root, "runs", "lessons.jsonl"));
    assert.ok(lessons.some((entry) => /Sort intervals by start/.test(entry.lesson)));
  } finally {
    await removeDir(root);
  }
});

test("runTask records proposer errors and can recover on the next iteration", async () => {
  const task = await findTask(path.join(rsiRoot, "benchmarks"), "interval-merge");
  let calls = 0;
  const proposer = new ScriptedProposer(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("simulated proposer failure");
    }
    return { files: referenceSolutions[task.id], rationale: "recovered", lessons: [] };
  });

  const result = await runTask(task, {
    proposer,
    maxIterations: 2,
    measureBaselineBenchmark: false
  });

  assert.equal(result.history.length, 2);
  assert.match(result.history[0].error, /simulated proposer failure/);
  assert.equal(result.history[0].accepted, false);
  assert.equal(result.history[1].accepted, true);
  assert.equal(result.best.hiddenPassRate, 1);
});

test("runSuite aggregates multiple tasks with a fresh proposer per task", async () => {
  const tasks = [
    await findTask(path.join(rsiRoot, "benchmarks"), "interval-merge"),
    await findTask(path.join(rsiRoot, "benchmarks"), "lru-cache")
  ];
  const suite = await runSuite(tasks, {
    proposerFactory: async (task) =>
      new ScriptedProposer([{ files: referenceSolutions[task.id], rationale: "reference", lessons: [] }]),
    maxIterations: 1,
    measureBaselineBenchmark: false
  });

  assert.equal(suite.results.length, 2);
  assert.equal(suite.aggregate.tasks, 2);
  assert.equal(suite.aggregate.solved, 2);
  assert.equal(suite.aggregate.improved, 2);
  assert.ok(suite.aggregate.meanScore >= 0.95);
});

test("listTasks discovers exactly the maintained benchmark suite", async () => {
  const tasks = await listTasks(path.join(rsiRoot, "benchmarks"));
  assert.deepEqual(
    tasks.map((task) => task.id),
    [
      "algorithms/dijkstra",
      "algorithms/edit-distance",
      "algorithms/interval-merge",
      "algorithms/lru-cache",
      "algorithms/median-stream",
      "algorithms/sliding-window-max",
      "algorithms/top-k-frequent",
      "algorithms/union-find"
    ]
  );
});
