import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeRelativePath, pathExists, readJson } from "./util.mjs";

const requiredString = (value, field, taskDir) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${taskDir}: "${field}" must be a non-empty string.`);
  }
  return value.trim();
};

const resolveInside = (taskDir, relative, field) => {
  const resolved = path.resolve(taskDir, relative);
  const root = path.resolve(taskDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${taskDir}: "${field}" escapes the task directory.`);
  }
  return resolved;
};

const validateCommand = (value, field, taskDir) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((part) => typeof part !== "string" || !part)) {
    throw new Error(`${taskDir}: "${field}" must be a non-empty array of strings.`);
  }
  return [...value];
};

const validateWeights = (value, taskDir) => {
  const weights = value ?? { correctness: 0.7, performance: 0.2, quality: 0.1 };
  for (const key of ["correctness", "performance", "quality"]) {
    if (typeof weights[key] !== "number" || !Number.isFinite(weights[key]) || weights[key] < 0) {
      throw new Error(`${taskDir}: weights.${key} must be a non-negative number.`);
    }
  }

  const total = weights.correctness + weights.performance + weights.quality;
  if (total <= 0) {
    throw new Error(`${taskDir}: at least one score weight must be positive.`);
  }

  return {
    correctness: weights.correctness / total,
    performance: weights.performance / total,
    quality: weights.quality / total
  };
};

export async function loadTask(taskDir) {
  const absoluteDir = path.resolve(taskDir);
  const specPath = path.join(absoluteDir, "task.json");
  if (!(await pathExists(specPath))) {
    throw new Error(`No task.json found in ${absoluteDir}`);
  }

  const spec = await readJson(specPath);
  const id = requiredString(spec.id, "id", absoluteDir);
  const title = requiredString(spec.title ?? id, "title", absoluteDir);
  const category = requiredString(spec.category ?? "algorithms", "category", absoluteDir);
  const promptPath = resolveInside(absoluteDir, spec.prompt ?? "prompt.md", "prompt");
  if (!(await pathExists(promptPath))) {
    throw new Error(`${absoluteDir}: prompt file not found: ${spec.prompt ?? "prompt.md"}`);
  }

  const prompt = await fs.readFile(promptPath, "utf8");
  const workspaceDir = resolveInside(absoluteDir, spec.workspace ?? "workspace", "workspace");
  const publicTestsDir = resolveInside(absoluteDir, spec.publicTestsDir ?? "tests", "publicTestsDir");
  const hiddenTestsDir = resolveInside(absoluteDir, spec.hiddenTestsDir ?? "hidden", "hiddenTestsDir");
  const benchmarkFile = resolveInside(absoluteDir, spec.benchmarkFile ?? "bench.mjs", "benchmarkFile");

  if (!(await pathExists(workspaceDir))) {
    throw new Error(`${absoluteDir}: workspace directory not found.`);
  }
  if (!(await pathExists(publicTestsDir))) {
    throw new Error(`${absoluteDir}: public tests directory not found.`);
  }

  const editable = (spec.editable ?? []).map((value) => normalizeRelativePath(value));
  if (!editable.length) {
    throw new Error(`${absoluteDir}: "editable" must list at least one file.`);
  }
  if (new Set(editable).size !== editable.length) {
    throw new Error(`${absoluteDir}: "editable" contains duplicates.`);
  }

  const testCommand = validateCommand(spec.testCommand, "testCommand", absoluteDir);
  const hiddenCommand = validateCommand(spec.hiddenCommand, "hiddenCommand", absoluteDir);

  let benchmark;
  if (spec.benchmark) {
    if (!(await pathExists(benchmarkFile))) {
      throw new Error(`${absoluteDir}: benchmark file not found: ${spec.benchmarkFile ?? "bench.mjs"}`);
    }
    benchmark = {
      command: validateCommand(spec.benchmark.command, "benchmark.command", absoluteDir),
      targetMs: Number(spec.benchmark.targetMs),
      maxMs: Number(spec.benchmark.maxMs),
      runs: Number(spec.benchmark.runs ?? 3),
      timeoutMs: Number(spec.benchmark.timeoutMs ?? spec.timeoutMs ?? 30000)
    };
    if (!Number.isFinite(benchmark.targetMs) || !Number.isFinite(benchmark.maxMs) || benchmark.maxMs <= benchmark.targetMs) {
      throw new Error(`${absoluteDir}: benchmark.targetMs and benchmark.maxMs must be finite, with maxMs > targetMs.`);
    }
    if (!Number.isInteger(benchmark.runs) || benchmark.runs < 1 || benchmark.runs > 10) {
      throw new Error(`${absoluteDir}: benchmark.runs must be an integer between 1 and 10.`);
    }
    if (!Number.isFinite(benchmark.timeoutMs) || benchmark.timeoutMs <= 0) {
      throw new Error(`${absoluteDir}: benchmark.timeoutMs must be a positive number.`);
    }
  }

  return {
    id,
    title,
    category,
    difficulty: Number(spec.difficulty ?? 1),
    tags: Array.isArray(spec.tags) ? spec.tags.map(String) : [],
    dir: absoluteDir,
    spec,
    prompt,
    workspaceDir,
    publicTestsDir,
    hiddenTestsDir,
    benchmarkFile,
    benchmark,
    editable,
    testCommand,
    hiddenCommand,
    timeoutMs: Number(spec.timeoutMs ?? 30000),
    maxFileBytes: Number(spec.maxFileBytes ?? 30000),
    maxFiles: Number(spec.maxFiles ?? editable.length),
    weights: validateWeights(spec.weights, absoluteDir)
  };
}

async function findTaskFiles(root) {
  const results = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "runs") {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.name === "task.json") {
        results.push(path.dirname(full));
      }
    }
  }
  await visit(path.resolve(root));
  return results.sort();
}

export async function listTasks(root) {
  const tasks = [];
  for (const taskDir of await findTaskFiles(root)) {
    tasks.push(await loadTask(taskDir));
  }
  return tasks.sort((left, right) => left.id.localeCompare(right.id));
}

export async function findTask(root, query) {
  const tasks = await listTasks(root);
  const normalized = String(query ?? "").replace(/\\/g, "/").toLowerCase();
  const matches = tasks.filter((task) => {
    const id = task.id.toLowerCase();
    const dir = task.dir.replace(/\\/g, "/").toLowerCase();
    return id === normalized || id.endsWith(`/${normalized}`) || dir.endsWith(normalized) || task.title.toLowerCase() === normalized;
  });

  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`Task query "${query}" is ambiguous: ${matches.map((task) => task.id).join(", ")}`);
  }
  throw new Error(`Task not found: ${query}`);
}

export function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    difficulty: task.difficulty,
    editable: task.editable,
    hasBenchmark: Boolean(task.benchmark)
  };
}
