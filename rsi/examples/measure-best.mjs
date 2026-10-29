import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateTask, parseBenchmarkMs, performanceScore, runCommand } from "../src/evaluator.mjs";
import { applyFiles, cleanupSandbox, createSandbox } from "../src/workspace.mjs";
import { listTasks } from "../src/task.mjs";
import { median, safeId } from "../src/util.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(moduleDir, "..");
const benchmarksRoot = path.join(rsiRoot, "benchmarks");

function parseArgs(argv) {
  const options = {
    runs: 10,
    before: path.join(rsiRoot, "runs"),
    after: undefined,
    tasks: undefined,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--runs") {
      options.runs = Number(argv[(index += 1)]);
    } else if (argument === "--before") {
      options.before = path.resolve(argv[(index += 1)]);
    } else if (argument === "--after") {
      options.after = path.resolve(argv[(index += 1)]);
    } else if (argument === "--tasks") {
      options.tasks = String(argv[(index += 1)])
        .split(",")
        .map((query) => query.trim())
        .filter(Boolean);
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isFinite(options.runs) || options.runs < 1) {
    throw new Error("--runs must be a positive integer.");
  }
  return options;
}

async function readBestFiles(directory, task) {
  if (!directory) {
    return undefined;
  }
  const files = {};
  for (const relative of task.editable) {
    const file = path.join(directory, safeId(task.id), "best", ...relative.split("/"));
    files[relative] = await fs.readFile(file, "utf8");
  }
  return files;
}

async function createRunner(task, files) {
  const sandbox = await createSandbox(task);
  await applyFiles(sandbox.workspaceDir, files);
  const timeoutMs = task.benchmark?.timeoutMs ?? task.timeoutMs;
  return {
    sandbox,
    async run() {
      const result = await runCommand(task.benchmark.command, {
        cwd: sandbox.root,
        timeoutMs
      });
      if (result.timedOut || result.code !== 0) {
        return undefined;
      }
      return parseBenchmarkMs(result.stdout, result.durationMs);
    }
  };
}

async function measureTask(task, files, runs) {
  const names = Object.keys(files).filter((name) => files[name]);
  const runners = {};
  const samples = Object.fromEntries(names.map((name) => [name, []]));
  try {
    for (const name of names) {
      runners[name] = await createRunner(task, files[name]);
    }

    // Rotate the solution order every round so CPU-frequency drift and the
    // sandbox position do not systematically favour one implementation.
    for (let round = 0; round < runs; round += 1) {
      const order = names.map((_, offset) => names[(offset + round) % names.length]);
      for (const name of order) {
        const benchMs = await runners[name].run();
        if (Number.isFinite(benchMs)) {
          samples[name].push(benchMs);
        }
      }
    }
  } finally {
    for (const runner of Object.values(runners)) {
      await cleanupSandbox(runner.sandbox);
    }
  }

  const measured = {};
  for (const name of names) {
    const evaluation = await evaluateTask(task, { files: files[name], measureBenchmark: false });
    const benchMs = median(samples[name]);
    const performance = performanceScore(task.benchmark, benchMs);
    const score = Number.isFinite(evaluation.correctness)
      ? task.weights.correctness * evaluation.correctness +
        task.weights.performance * performance +
        task.weights.quality * evaluation.quality
      : 0;
    measured[name] = {
      benchMs: Number.isFinite(benchMs) ? benchMs : null,
      runs: samples[name],
      score: Number(score.toFixed(4)),
      hidden: `${evaluation.hiddenResult.passed}/${evaluation.hiddenResult.total}`,
      error: evaluation.error
    };
  }
  return measured;
}

const options = parseArgs(process.argv.slice(2));
const allTasks = await listTasks(benchmarksRoot);
const tasks = options.tasks
  ? allTasks.filter((task) =>
      options.tasks.some((query) => task.id === query || task.id.endsWith(`/${query}`))
    )
  : allTasks;
if (!tasks.length) {
  throw new Error(`No benchmark tasks matched: ${options.tasks?.join(", ")}`);
}
const rows = [];

for (const task of tasks) {
  const files = {
    before: await readBestFiles(options.before, task),
    after: await readBestFiles(options.after, task),
    reference: referenceSolutions[task.id]
  };
  const measured = await measureTask(task, files, options.runs);
  const row = { task: task.id, targetMs: task.benchmark?.targetMs ?? null, ...measured };
  rows.push(row);
  if (!options.json) {
    console.log(
      `${row.task}\ttarget=${row.targetMs}\tbefore=${row.before?.benchMs ?? "-"}\tafter=${
        row.after?.benchMs ?? "-"
      }\treference=${row.reference?.benchMs ?? "-"}`
    );
  }
}

if (options.json) {
  console.log(JSON.stringify(rows, null, 2));
}
