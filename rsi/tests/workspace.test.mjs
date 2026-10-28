import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTask } from "../src/task.mjs";
import {
  applyToTarget,
  cleanupSandbox,
  createSandbox,
  readCurrentEditable,
  validateProposal
} from "../src/workspace.mjs";
import { pathExists, readText, removeDir } from "../src/util.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");
const taskDir = path.join(rsiRoot, "benchmarks", "algorithms", "interval-merge");

test("loadTask resolves editable paths and benchmark settings", async () => {
  const task = await loadTask(taskDir);
  assert.equal(task.id, "algorithms/interval-merge");
  assert.deepEqual(task.editable, ["solution.js"]);
  assert.ok(Math.abs(task.weights.correctness + task.weights.performance + task.weights.quality - 1) < 1e-9);
  assert.ok(task.benchmark.timeoutMs > 0);
});

test("validateProposal accepts editable files and rejects unsafe or oversized proposals", async () => {
  const task = await loadTask(taskDir);
  const accepted = validateProposal(task, { "solution.js": "export function mergeIntervals() { return []; }\n" });
  assert.deepEqual(Object.keys(accepted), ["solution.js"]);

  assert.throws(() => validateProposal(task, { "../solution.js": "x" }), /Unsafe|path/i);
  assert.throws(() => validateProposal(task, { "tests/public.test.mjs": "x" }), /non-editable/);
  assert.throws(() => validateProposal(task, { "solution.js": "" }), /empty/);
  assert.throws(
    () => validateProposal(task, { "solution.js": "x".repeat(task.maxFileBytes + 1) }),
    /limit|exceeds/
  );
  assert.throws(() => validateProposal(task, {}), /did not include any files/);
});

test("createSandbox copies the workspace, public tests, benchmark, and task brief", async () => {
  const task = await loadTask(taskDir);
  const sandbox = await createSandbox(task);
  try {
    assert.ok(await pathExists(path.join(sandbox.workspaceDir, "solution.js")));
    assert.ok(await pathExists(path.join(sandbox.testsDir, "public.test.mjs")));
    assert.ok(await pathExists(path.join(sandbox.root, "bench.mjs")));
    const brief = await readText(path.join(sandbox.root, "TASK.md"));
    assert.match(brief, /Merge Intervals/);
    assert.match(brief, /solution\.js/);
    assert.ok(!(await pathExists(path.join(sandbox.root, "hidden"))));
  } finally {
    await cleanupSandbox(sandbox);
  }
  assert.equal(await pathExists(sandbox.root), false);
});

test("readCurrentEditable reads exactly the declared files", async () => {
  const task = await loadTask(taskDir);
  const files = await readCurrentEditable(task);
  assert.deepEqual(Object.keys(files), ["solution.js"]);
  assert.match(files["solution.js"], /mergeIntervals/);
});

test("applyToTarget writes only validated relative paths", async () => {
  const task = await loadTask(taskDir);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-apply-"));
  try {
    const applied = await applyToTarget(task, { "solution.js": "export const value = 1;\n" }, target);
    assert.deepEqual(applied, ["solution.js"]);
    assert.equal(await readText(path.join(target, "solution.js")), "export const value = 1;\n");
    await assert.rejects(applyToTarget(task, { "../escape.js": "x" }, target), /Unsafe|path/i);
    assert.equal(await pathExists(path.join(path.dirname(target), "escape.js")), false);
  } finally {
    await removeDir(target);
  }
});
