import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LessonStore, RunArchive, summarizeFailure } from "../src/memory.mjs";
import { pathExists, readJsonLines, readText, removeDir } from "../src/util.mjs";

function taskLike() {
  return {
    id: "algorithms/interval-merge",
    title: "Merge Intervals",
    category: "algorithms",
    tags: ["sorting", "intervals", "greedy"]
  };
}

test("LessonStore persists, deduplicates, and retrieves relevant lessons", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-memory-"));
  try {
    const file = path.join(root, "lessons.jsonl");
    const store = new LessonStore({ file });
    await store.add({
      taskId: "algorithms/interval-merge",
      tags: ["sorting", "intervals"],
      lesson: "Sort intervals by start before merging.",
      accepted: true,
      scoreDelta: 0.35
    });
    await store.add({
      taskId: "algorithms/lru-cache",
      tags: ["hash-map"],
      lesson: "Use a Map plus recency tracking for O(1) operations.",
      accepted: true,
      scoreDelta: 0.1
    });
    await store.add({
      taskId: "algorithms/interval-merge",
      tags: ["sorting"],
      lesson: "sort intervals by start before merging.",
      accepted: false,
      scoreDelta: -0.2
    });

    const lessons = await store.retrieve(taskLike(), 5);
    assert.equal(lessons.length, 2);
    assert.equal(lessons[0].lesson, "Sort intervals by start before merging.");
    assert.equal(lessons[0].accepted, true);
    assert.equal(lessons[0].scoreDelta, 0.35);

    const lines = await readJsonLines(file);
    assert.equal(lines.length, 2);
    assert.ok(lines.some((line) => /Sort intervals/.test(line.lesson)));

    const reloaded = new LessonStore({ file });
    const persisted = await reloaded.load();
    assert.equal(persisted.length, 2);
  } finally {
    await removeDir(root);
  }
});

test("LessonStore ignores malformed entries and seeds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-memory-"));
  try {
    const file = path.join(root, "lessons.jsonl");
    await fs.writeFile(file, '{"lesson":"valid lesson"}\nnot json\n{"nope":true}\n', "utf8");
    const store = new LessonStore({ file, seed: [{ lesson: "seeded lesson", tags: ["sorting"] }] });
    const lessons = await store.load();
    assert.deepEqual(lessons.map((lesson) => lesson.lesson), ["seeded lesson", "valid lesson"]);
  } finally {
    await removeDir(root);
  }
});

test("RunArchive writes iterations, best files, and a report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-archive-"));
  try {
    const archive = new RunArchive({ root });
    await archive.record("algorithms/interval-merge", { iteration: 1, accepted: true, score: 1 });
    await archive.saveBest("algorithms/interval-merge", { "solution.js": "export const x = 1;\n" });
    await archive.saveReport("algorithms/interval-merge", "# report\n");

    const taskDir = path.join(root, "algorithms-interval-merge");
    const records = await readJsonLines(path.join(taskDir, "iterations.jsonl"));
    assert.equal(records.length, 1);
    assert.equal(records[0].score, 1);
    assert.equal(await readText(path.join(taskDir, "best", "solution.js")), "export const x = 1;\n");
    assert.equal(await readText(path.join(taskDir, "report.md")), "# report\n");
    assert.ok(await pathExists(taskDir));
  } finally {
    await removeDir(root);
  }
});

test("summarizeFailure combines all diagnostic channels", () => {
  const message = summarizeFailure({
    error: "evaluation blew up",
    hiddenResult: { failures: ["hidden alpha", "hidden beta"] },
    publicResult: { failures: ["public alpha"] },
    violations: ["solution.js: eval"],
    score: 0
  });
  assert.match(message, /evaluation blew up/);
  assert.match(message, /hidden alpha/);
  assert.match(message, /public alpha/);
  assert.match(message, /eval/);
  assert.match(summarizeFailure({ score: 0.5, hiddenResult: {}, publicResult: {} }), /No improvement/);

  const task = { benchmark: { targetMs: 50, maxMs: 500 } };
  assert.match(
    summarizeFailure(
      { score: 0.8, hiddenResult: {}, publicResult: {}, benchMs: 120, performance: 0.7 },
      task
    ),
    /120ms misses target 50ms/
  );
  assert.match(
    summarizeFailure({ score: 0.8, hiddenResult: {}, publicResult: {}, performance: 0 }, task),
    /no successful run/
  );

  const performanceContext = {
    optimizePerformance: true,
    minSpeedup: 0.05,
    bestBenchMs: 100,
    bestScore: 1,
    bestHiddenPassRate: 1
  };
  const tooSlow = summarizeFailure(
    {
      score: 1,
      hiddenPassRate: 1,
      benchMs: 96,
      performance: 1,
      hiddenResult: {},
      publicResult: {},
      violations: []
    },
    task,
    performanceContext
  );
  assert.match(tooSlow, /96ms misses the performance win/);
  assert.match(tooSlow, /current best 100ms/);
  assert.match(tooSlow, /needs < 95ms \(5% faster\)/);

  assert.match(
    summarizeFailure(
      {
        score: 1,
        hiddenPassRate: 1,
        benchMs: 3.7,
        performance: 1,
        hiddenResult: {},
        publicResult: {},
        violations: []
      },
      task,
      { ...performanceContext, bestBenchMs: 4 }
    ),
    /by only 0\.3ms, below the 0\.5ms minimum measurable win/
  );

  assert.match(
    summarizeFailure(
      {
        score: 1,
        hiddenPassRate: 1,
        benchMs: 0.1,
        performance: 1,
        hiddenResult: {},
        publicResult: {},
        violations: []
      },
      task,
      { ...performanceContext, bestBenchMs: 0.3 }
    ),
    /below the 0\.5ms minimum measurable win/
  );

  const correctnessFirst = summarizeFailure(
    {
      score: 0.8,
      hiddenPassRate: 0.5,
      benchMs: 96,
      performance: 1,
      hiddenResult: {},
      publicResult: {},
      violations: []
    },
    task,
    performanceContext
  );
  assert.doesNotMatch(correctnessFirst, /not at least/);

  assert.match(
    summarizeFailure(
      {
        score: 1,
        hiddenPassRate: 1,
        benchMs: 0,
        performance: 1,
        hiddenResult: {},
        publicResult: {},
        violations: []
      },
      task,
      { ...performanceContext, bestBenchMs: 0 }
    ),
    /below timer resolution/
  );
});
