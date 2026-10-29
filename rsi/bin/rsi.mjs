#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTask, listTasks, taskSummary } from "../src/task.mjs";
import { runSuite, runTask } from "../src/loop.mjs";
import { CommandMetaProposer, runMeta } from "../src/meta.mjs";
import { CommandProposer, HttpProposer, ScriptedProposer } from "../src/proposers.mjs";
import { LessonStore, RunArchive, defaultRunsDir } from "../src/memory.mjs";
import { defaultConfigPath, loadProvider, redactProvider } from "../src/provider.mjs";
import { applyToTarget } from "../src/workspace.mjs";
import { summarizeEvaluation } from "../src/evaluator.mjs";
import { pathExists } from "../src/util.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(moduleDir, "..");
const benchmarksRoot = path.join(rsiRoot, "benchmarks");

const booleanFlags = new Set([
  "json",
  "yes",
  "apply",
  "no-archive",
  "help",
  "quiet",
  "optimize-performance"
]);

function parseArgs(argv) {
  let command = argv[0] ?? "help";
  let rest = argv.slice(1);
  if (command.startsWith("--")) {
    rest = argv;
    command = "help";
  }
  const flags = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--") {
      flags._.push(...rest.slice(index + 1));
      break;
    }
    if (!argument.startsWith("--")) {
      flags._.push(argument);
      continue;
    }

    const equals = argument.indexOf("=");
    if (equals !== -1) {
      flags[argument.slice(2, equals)] = argument.slice(equals + 1);
      continue;
    }

    const key = argument.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    flags[key] = value;
    index += 1;
  }
  return { command, flags };
}

function numericFlag(flags, name, fallback, minimum, maximum) {
  if (flags[name] === undefined) {
    return fallback;
  }
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

async function selectTasks(flags, options = {}) {
  if (flags.task) {
    return [await findTask(benchmarksRoot, flags.task)];
  }
  if (flags.tasks) {
    const queries = String(flags.tasks)
      .split(",")
      .map((query) => query.trim())
      .filter(Boolean);
    const tasks = [];
    for (const query of queries) {
      tasks.push(await findTask(benchmarksRoot, query));
    }
    return tasks;
  }
  if (options.requireSelection) {
    throw new Error("This command requires --task or --tasks.");
  }
  return listTasks(benchmarksRoot);
}

async function createProposerFactory(kind, flags) {
  if (kind === "reference") {
    return async (task) => {
      const files = referenceSolutions[task.id];
      if (!files) {
        throw new Error(`No reference solution is registered for ${task.id}.`);
      }
      return new ScriptedProposer(() => ({
        files,
        rationale: "Scripted reference solution used to self-test the harness.",
        lessons: []
      }));
    };
  }

  if (kind === "command") {
    const loaded = await loadProvider({ providerId: flags.provider });
    const provider = loaded
      ? { ...loaded, ...(flags.model ? { model: flags.model } : {}) }
      : undefined;
    if (!loaded && flags.model) {
      // `claude --model` is passed explicitly below; without a provider config
      // the CLI keeps its own ambient credentials.
    }
    const args = ["-p", "--output-format", "text"];
    if (flags.model) {
      args.push("--model", flags.model);
    }
    const timeoutMs = numericFlag(flags, "timeout", 300000, 1000, 3600000);
    return async () =>
      new CommandProposer({
        command: flags.command ?? "claude",
        args,
        timeoutMs,
        provider,
        cwd: flags["proposer-cwd"] ? path.resolve(flags["proposer-cwd"]) : undefined
      });
  }

  if (kind === "http") {
    const provider = await loadProvider({ providerId: flags.provider });
    if (!provider) {
      throw new Error("HTTP proposer needs a provider config, or ANTHROPIC_* environment variables.");
    }
    if (!provider.baseUrl) {
      throw new Error("HTTP proposer needs a provider base URL.");
    }
    if (!provider.token) {
      throw new Error("HTTP proposer needs a provider token.");
    }
    const model = flags.model ?? provider.model;
    if (!model) {
      throw new Error("HTTP proposer needs --model or a provider model.");
    }
    const timeoutMs = numericFlag(flags, "timeout", 300000, 1000, 3600000);
    return async () =>
      new HttpProposer({
        baseUrl: provider.baseUrl,
        apiKey: provider.token,
        authType: provider.authType,
        model,
        timeoutMs
      });
  }

  throw new Error(`Unknown proposer "${kind}". Use reference, command, or http.`);
}

function progressHandler(flags) {
  if (flags.json || flags.quiet) {
    return undefined;
  }
  return (progress) => {
    if (progress.error) {
      process.stderr.write(`iteration ${progress.iteration}: ${progress.error}\n`);
      return;
    }
    const evaluation = progress.evaluation;
    if (!evaluation) {
      return;
    }
    const summary = summarizeEvaluation(evaluation);
    const status = progress.accepted
      ? `accepted (${progress.reason ?? "score"})`
      : "rejected";
    process.stderr.write(
      `iteration ${progress.iteration}: score ${summary.score} hidden ${summary.hidden} public ${summary.public} bench ${summary.benchMs ?? "n/a"}ms ${status}\n`
    );
  };
}

function evaluationSummary(evaluation) {
  return summarizeEvaluation(evaluation);
}

function resultSummary(result, applied = []) {
  return {
    task: result.task.id,
    baseline: evaluationSummary(result.baseline),
    best: evaluationSummary(result.best),
    targetMs: result.task.benchmark?.targetMs ?? null,
    maxMs: result.task.benchmark?.maxMs ?? null,
    acceptedIterations: result.history.filter((entry) => entry.accepted).length,
    performanceIterations: result.history.filter(
      (entry) => entry.accepted && entry.reason === "performance"
    ).length,
    iterations: result.history.length,
    bestFiles: Object.keys(result.bestFiles),
    applied,
    history: result.history.map((entry) => ({
      iteration: entry.iteration,
      accepted: entry.accepted,
      reason: entry.reason ?? null,
      score: entry.evaluation ? round(entry.evaluation.score) : null,
      benchMs: entry.evaluation?.benchMs === undefined ? null : Math.round(entry.evaluation.benchMs),
      error: entry.error,
      rationale: entry.rationale
    }))
  };
}

async function maybeApply(task, result, flags) {
  if (!flags.apply) {
    return [];
  }
  if (!flags.yes) {
    throw new Error("--apply is human-gated: pass --yes after reviewing the proposed files.");
  }
  if (!flags.target) {
    throw new Error("--apply requires an explicit --target directory.");
  }
  const target = path.resolve(flags.target);
  let stats;
  try {
    stats = await fs.stat(target);
  } catch {
    throw new Error(`--target does not exist: ${target}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`--target is not a directory: ${target}`);
  }
  return applyToTarget(task, result.bestFiles, target);
}

async function archiveMetaResult(result, runsDir = defaultRunsDir) {
  const directory = path.join(runsDir, "meta");
  await fs.mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const content = result.template.endsWith("\n") ? result.template : `${result.template}\n`;
  const history = JSON.stringify(
    { meanScore: result.baseline.meanScore, history: result.history },
    null,
    2
  );
  const templateFile = path.join(directory, `${stamp}.md`);
  const historyFile = path.join(directory, `${stamp}.json`);
  await fs.writeFile(templateFile, content, "utf8");
  await fs.writeFile(historyFile, `${history}\n`, "utf8");
  await fs.writeFile(path.join(directory, "latest.md"), content, "utf8");
  await fs.writeFile(path.join(directory, "latest.json"), `${history}\n`, "utf8");
  return { templateFile, historyFile };
}

async function maybeApplyMetaTemplate(result, flags) {
  if (!flags.apply) {
    return undefined;
  }
  if (!flags.yes) {
    throw new Error("--apply is human-gated: pass --yes after reviewing the proposed template.");
  }
  const target = path.resolve(flags.target ?? path.join(rsiRoot, "prompts", "proposer.v1.md"));
  let stats;
  try {
    stats = await fs.stat(target);
  } catch {
    throw new Error(`--target does not exist: ${target}`);
  }
  if (stats.isDirectory()) {
    throw new Error(`--target must be a file, not a directory: ${target}`);
  }
  const content = result.template.endsWith("\n") ? result.template : `${result.template}\n`;
  await fs.writeFile(target, content, "utf8");
  return target;
}

async function commandList(flags) {
  const tasks = await listTasks(benchmarksRoot);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(tasks.map(taskSummary), null, 2)}\n`);
    return 0;
  }
  for (const task of tasks) {
    process.stdout.write(
      `${task.id}\t${task.title}\t${task.category}\tdifficulty ${task.difficulty}\t${task.editable.join(",")}\n`
    );
  }
  return 0;
}

async function commandRun(flags) {
  const tasks = await selectTasks(flags, { requireSelection: true });
  const task = tasks[0];
  const proposerKind = flags.proposer ?? "command";
  const factory = await createProposerFactory(proposerKind, flags);
  const maxIterations = numericFlag(flags, "iterations", 3, 1, 50);
  const minDelta = numericFlag(flags, "min-delta", 0.01, 0, 1);
  const optimizePerformance = Boolean(flags["optimize-performance"]);
  const minSpeedup = numericFlag(flags, "min-speedup", 0.05, 0.01, 1);
  const minSpeedupMs = numericFlag(flags, "min-speedup-ms", 0.5, 0, 10000);
  const noArchive = Boolean(flags["no-archive"]);
  const runsDir = flags["archive-dir"] ? path.resolve(flags["archive-dir"]) : defaultRunsDir;
  const archive = noArchive ? undefined : new RunArchive({ root: runsDir });
  const lessonStore = noArchive ? undefined : new LessonStore({ file: path.join(runsDir, "lessons.jsonl") });
  const result = await runTask(task, {
    proposer: await factory(task),
    maxIterations,
    minDelta,
    optimizePerformance,
    minSpeedup,
    minSpeedupMs,
    archive,
    lessonStore,
    onProgress: progressHandler(flags)
  });
  const applied = await maybeApply(task, result, flags);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ...resultSummary(result, applied), report: result.report }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${result.report}\n`);
  if (applied.length) {
    process.stdout.write(`Applied to ${path.resolve(flags.target)}:\n${applied.map((file) => `- ${file}`).join("\n")}\n`);
  }
  return 0;
}

async function commandSuite(flags) {
  const tasks = await selectTasks(flags);
  const proposerKind = flags.proposer ?? "command";
  const factory = await createProposerFactory(proposerKind, flags);
  const maxIterations = numericFlag(flags, "iterations", 3, 1, 50);
  const minDelta = numericFlag(flags, "min-delta", 0.01, 0, 1);
  const optimizePerformance = Boolean(flags["optimize-performance"]);
  const minSpeedup = numericFlag(flags, "min-speedup", 0.05, 0.01, 1);
  const minSpeedupMs = numericFlag(flags, "min-speedup-ms", 0.5, 0, 10000);
  const noArchive = Boolean(flags["no-archive"]);
  const runsDir = flags["archive-dir"] ? path.resolve(flags["archive-dir"]) : defaultRunsDir;
  const archive = noArchive ? undefined : new RunArchive({ root: runsDir });
  const lessonStore = noArchive ? undefined : new LessonStore({ file: path.join(runsDir, "lessons.jsonl") });
  const suite = await runSuite(tasks, {
    proposerFactory: factory,
    maxIterations,
    minDelta,
    optimizePerformance,
    minSpeedup,
    minSpeedupMs,
    archive,
    lessonStore,
    onProgress: progressHandler(flags)
  });

  const summaries = suite.results.map((result) => resultSummary(result));
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ aggregate: suite.aggregate, results: summaries }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write("task\tbaseline\tbest\thidden\tbaselineMs\tbestMs\ttargetMs\taccepted\tperf\n");
  for (const summary of summaries) {
    process.stdout.write(
      `${summary.task}\t${summary.baseline.score}\t${summary.best.score}\t${summary.best.hidden}\t${
        summary.baseline.benchMs ?? "-"
      }\t${summary.best.benchMs ?? "-"}\t${summary.targetMs ?? "-"}\t${summary.acceptedIterations}/${
        summary.iterations
      }\t${summary.performanceIterations}\n`
    );
  }
  process.stdout.write(
    `mean best score ${round(suite.aggregate.meanScore)} over ${suite.aggregate.tasks} tasks; solved ${suite.aggregate.solved}; improved ${suite.aggregate.improved}; performance-optimized ${suite.aggregate.performanceImproved}\n`
  );
  return 0;
}

async function commandMeta(flags) {
  if (flags.apply && !flags.yes) {
    throw new Error("--apply is human-gated: pass --yes after reviewing the proposed template.");
  }
  const tasks = await selectTasks(flags, { requireSelection: true });
  const proposerKind = flags.proposer ?? "command";
  const factory = await createProposerFactory(proposerKind, flags);
  const metaKind = flags["meta-proposer"] ?? "command";
  if (metaKind !== "command") {
    throw new Error("Only --meta-proposer command is supported.");
  }
  const provider = await loadProvider({ providerId: flags.provider });
  const metaArgs = ["-p", "--output-format", "text"];
  if (flags.model) {
    metaArgs.push("--model", flags.model);
  }
  const metaProposer = new CommandMetaProposer({
    command: flags.command ?? "claude",
    args: metaArgs,
    timeoutMs: numericFlag(flags, "timeout", 300000, 1000, 3600000),
    provider,
    cwd: flags["proposer-cwd"] ? path.resolve(flags["proposer-cwd"]) : undefined
  });
  const rounds = numericFlag(flags, "rounds", 2, 1, 10);
  const maxRegression = numericFlag(flags, "max-regression", 0.03, 0, 1);
  const minCostReduction = numericFlag(flags, "min-cost-reduction", 0.1, 0, 1);
  const runsDir = flags["archive-dir"] ? path.resolve(flags["archive-dir"]) : defaultRunsDir;
  const result = await runMeta({
    tasks,
    proposerFactory: factory,
    metaProposer,
    rounds,
    maxIterations: numericFlag(flags, "iterations", 2, 1, 50),
    maxRegression,
    minCostReduction,
    lessonStore: flags["no-archive"] ? undefined : new LessonStore({ file: path.join(runsDir, "lessons.jsonl") })
  });

  const archived = flags["no-archive"] ? undefined : await archiveMetaResult(result, runsDir);
  const appliedTo = await maybeApplyMetaTemplate(result, flags);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      history: result.history,
      meanScore: round(result.baseline.meanScore),
      template: result.template,
      archived,
      appliedTo
    }, null, 2)}\n`);
    return 0;
  }

  for (const entry of result.history) {
    if (entry.error) {
      process.stdout.write(`round ${entry.round}: rejected (${entry.error})\n`);
    } else {
      process.stdout.write(
        `round ${entry.round}: ${entry.before} -> ${entry.after} ${entry.accepted ? "accepted" : "rejected"}${
          entry.rationale ? ` — ${entry.rationale}` : ""
        }\n`
      );
    }
  }
  process.stdout.write(`final mean score ${round(result.baseline.meanScore)}\n`);
  if (archived) {
    process.stdout.write(`archived template ${archived.templateFile}\n`);
  }
  if (appliedTo) {
    process.stdout.write(`applied template ${appliedTo}\n`);
  }
  return 0;
}

async function commandDemo(flags) {
  const tasks = await listTasks(benchmarksRoot);
  const factory = await createProposerFactory("reference", flags);
  const suite = await runSuite(tasks, {
    proposerFactory: factory,
    maxIterations: 1,
    minDelta: 0.01,
    targetScore: 0.98
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      aggregate: suite.aggregate,
      results: suite.results.map((result) => resultSummary(result))
    }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write("Scripted-oracle demo: this validates the evaluation loop end to end.\n");
  process.stdout.write("It is not a measurement of model self-improvement.\n\n");
  process.stdout.write("task\tbaseline\tbest\tdelta\thidden\tbaselineMs\tbestMs\ttargetMs\n");
  for (const result of suite.results) {
    process.stdout.write(
      `${result.task.id}\t${round(result.baseline.score)}\t${round(result.best.score)}\t${round(
        result.best.score - result.baseline.score
      )}\t${result.best.hiddenResult.passed}/${result.best.hiddenResult.total}\t${
        result.baseline.benchMs === undefined ? "-" : Math.round(result.baseline.benchMs)
      }\t${result.best.benchMs === undefined ? "-" : Math.round(result.best.benchMs)}\t${
        result.task.benchmark?.targetMs ?? "-"
      }\n`
    );
  }
  const solved = suite.results.every((result) => result.best.hiddenResult.passed === result.best.hiddenResult.total);
  process.stdout.write(`\nmean best score ${round(suite.aggregate.meanScore)}\n`);
  return solved ? 0 : 1;
}

async function commandDoctor(flags) {
  const tasks = await listTasks(benchmarksRoot);
  let provider;
  let providerError;
  try {
    provider = await loadProvider();
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
  }
  const report = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    rsiRoot,
    benchmarks: tasks.length,
    tasks: tasks.map((task) => task.id),
    configPath: defaultConfigPath(),
    configExists: await pathExists(defaultConfigPath()),
    provider: redactProvider(provider),
    providerError,
    runsDir: defaultRunsDir
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return providerError ? 1 : 0;
  }
  process.stdout.write(`Node: ${report.node} (${report.platform})\n`);
  process.stdout.write(`Tasks: ${report.benchmarks} (${report.tasks.join(", ")})\n`);
  process.stdout.write(`Provider config: ${report.configPath} (${report.configExists ? "present" : "absent"})\n`);
  if (provider) {
    process.stdout.write(`Provider: ${provider.name} [${provider.id}] model=${provider.model ?? "default"} token=${provider.token ? "present" : "absent"}\n`);
  } else if (providerError) {
    process.stdout.write(`Provider: error: ${providerError}\n`);
  } else {
    process.stdout.write("Provider: none configured (environment fallback may apply)\n");
  }
  return providerError ? 1 : 0;
}

function helpText() {
  return `Usage: node rsi/bin/rsi.mjs <command> [options]

Commands:
  list                       List benchmark tasks
  run --task <id>            Run one task with a proposer
  suite                      Run all selected tasks
  meta --tasks <ids>         Optimize the proposer prompt template
  demo                       Scripted-oracle end-to-end harness check
  doctor                     Show environment and provider status (redacted)

Proposer options:
  --proposer reference|command|http   Default: command (claude -p)
  --provider <id>            Provider profile id from the switcher config
  --model <name>             Model override
  --iterations <n>           Max proposal iterations (default 3)
  --timeout <ms>             Proposer timeout (default 300000)
  --optimize-performance     Continue after the target score and accept equal-score speedups
  --min-speedup <x>          Minimum benchmark reduction for a performance-only win (default 0.05)
  --min-speedup-ms <ms>      Minimum absolute benchmark win for a performance-only acceptance (default 0.5)

Run options:
  --task <id> / --tasks <id,id>
  --no-archive               Do not write rsi/runs
  --archive-dir <dir>
  --json                     Machine-readable output
  --apply --target <dir> --yes       Human-gated write of best files
  --apply --target <file.md> --yes   Human-gated write of the meta template

Meta options:
  --rounds <n>               Max meta rounds (default 2)
  --min-delta <x>            Minimum mean-score gain (default 0.01)
  --max-regression <x>       Allowed per-task score loss (default 0.03)
  --min-cost-reduction <x>   Prompt-length reduction accepted without a score gain (default 0.1)

Examples:
  node rsi/bin/rsi.mjs demo
  node rsi/bin/rsi.mjs run --task interval-merge --proposer command --iterations 3
  node rsi/bin/rsi.mjs suite --tasks interval-merge,lru-cache --proposer http --model <model>
  node rsi/bin/rsi.mjs suite --proposer command --optimize-performance --iterations 3
  node rsi/bin/rsi.mjs meta --tasks interval-merge,lru-cache --rounds 2
`;
}

async function main(argv) {
  const { command, flags } = parseArgs(argv);
  if (flags.help || command === "help") {
    process.stdout.write(helpText());
    return 0;
  }
  switch (command) {
    case "list":
      return commandList(flags);
    case "run":
      return commandRun(flags);
    case "suite":
      return commandSuite(flags);
    case "meta":
      return commandMeta(flags);
    case "demo":
      return commandDemo(flags);
    case "doctor":
      return commandDoctor(flags);
    default:
      throw new Error(`Unknown command "${command}". Run with --help.`);
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
