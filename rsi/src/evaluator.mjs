import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clamp, copyDir, median, truncate } from "./util.mjs";
import { applyFiles, cleanupSandbox, createSandbox, validateProposal } from "./workspace.mjs";

const OUTPUT_LIMIT = 200_000;

function buildEvaluationEnv() {
  const env = {};
  const keep = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL"
  ];
  for (const key of keep) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  env.NODE_NO_WARNINGS = "1";
  return env;
}

function appendLimited(current, chunk) {
  if (current.length >= OUTPUT_LIMIT) {
    return current;
  }
  const next = current + chunk.toString();
  return next.length > OUTPUT_LIMIT ? `${next.slice(0, OUTPUT_LIMIT)}\n...[output truncated]` : next;
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!text) {
    return '""';
  }
  // cmd.exe treats these as syntax; quoting keeps the argument intact.
  if (!/[ \t\n\v"&|<>^()%!]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function spawnSpec(command, windowsShell) {
  if (windowsShell && process.platform === "win32") {
    // .cmd shims such as npm's `claude.cmd` cannot be launched directly by
    // CreateProcess. Route through cmd.exe, with every argument quoted and the
    // whole command wrapped so /s strips exactly the outer pair of quotes.
    const line = command.map(quoteWindowsArgument).join(" ");
    return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], true];
  }
  return [command[0], command.slice(1), false];
}

function killProcessTree(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    }).on("error", () => undefined);
    return;
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the timeout and this call.
    }
  }
}

export function runCommand(command, options = {}) {
  const { cwd, timeoutMs = 30000, env = buildEvaluationEnv(), input, windowsShell = false } = options;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer;

    const [spawnCommand, spawnArgs, windowsVerbatimArguments] = spawnSpec(command, windowsShell);
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      env,
      windowsHide: true,
      windowsVerbatimArguments,
      shell: false,
      detached: process.platform !== "win32"
    });

    const finish = (code, error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve({
        command,
        code: error ? -1 : code,
        stdout,
        stderr: error ? `${stderr}\n${error.message}`.trim() : stderr,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      killTimer = setTimeout(() => {
        finish(-1, new Error("Process tree did not exit after the timeout kill."));
      }, 5000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => finish(-1, error));
    child.on("close", (code) => finish(timedOut ? -1 : (code ?? -1)));

    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function parseTap(output) {
  const text = String(output ?? "");
  const passSummary = text.match(/^#\s*pass\s+(\d+)\s*$/im);
  const failSummary = text.match(/^#\s*fail\s+(\d+)\s*$/im);
  if (passSummary || failSummary) {
    const passed = Number(passSummary?.[1] ?? 0);
    const failed = Number(failSummary?.[1] ?? 0);
    return {
      total: passed + failed,
      passed,
      failed,
      failures: failed ? collectTapFailures(text) : [],
      parsed: true
    };
  }

  const okLines = [...text.matchAll(/^ok\s+\d+\s+-\s+(.+)$/gm)].map((match) => match[1].trim());
  const failedLines = [...text.matchAll(/^not ok\s+\d+\s+-\s+(.+)$/gm)].map((match) => match[1].trim());
  if (okLines.length || failedLines.length) {
    return {
      total: okLines.length + failedLines.length,
      passed: okLines.length,
      failed: failedLines.length,
      failures: failedLines.slice(0, 10),
      parsed: true
    };
  }

  return {
    total: 0,
    passed: 0,
    failed: 0,
    failures: [],
    parsed: false
  };
}

function collectTapFailures(text) {
  const failures = [];
  for (const match of text.matchAll(/^not ok\s+\d+\s+-\s+(.+)$/gm)) {
    failures.push(match[1].trim());
  }
  return failures.slice(0, 10);
}

function testResultFromCommand(commandResult, label) {
  if (commandResult.timedOut) {
    return {
      total: 1,
      passed: 0,
      failed: 1,
      failures: [`${label} timed out after ${commandResult.durationMs}ms`],
      parsed: false,
      timedOut: true,
      output: truncate(`${commandResult.stdout}\n${commandResult.stderr}`)
    };
  }

  const parsed = parseTap(commandResult.stdout);
  if (parsed.parsed) {
    return {
      ...parsed,
      timedOut: false,
      output: truncate(`${commandResult.stdout}\n${commandResult.stderr}`)
    };
  }

  const ok = commandResult.code === 0;
  return {
    total: 1,
    passed: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    failures: ok ? [] : [truncate(commandResult.stderr || commandResult.stdout, 500)],
    parsed: false,
    timedOut: false,
    output: truncate(`${commandResult.stdout}\n${commandResult.stderr}`)
  };
}

const forbiddenPatterns = [
  { label: "filesystem access", pattern: /\brequire\s*\(\s*['"](?:node:)?fs['"]\s*\)|\bfrom\s*['"](?:node:)?fs['"]/ },
  { label: "child process access", pattern: /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)|\bfrom\s*['"](?:node:)?child_process['"]/ },
  { label: "network access", pattern: /\brequire\s*\(\s*['"](?:node:)?(?:net|http|https|dgram|tls)['"]\s*\)|\bfrom\s*['"](?:node:)?(?:net|http|https|dgram|tls)['"]/ },
  { label: "worker or VM access", pattern: /\brequire\s*\(\s*['"](?:node:)?(?:worker_threads|vm)['"]\s*\)|\bfrom\s*['"](?:node:)?(?:worker_threads|vm)['"]/ },
  { label: "environment access", pattern: /\bprocess\s*\.\s*env\b/ },
  { label: "dynamic import", pattern: /\bimport\s*\(\s*['"]/ },
  { label: "eval", pattern: /\beval\s*\(/ },
  { label: "Function constructor", pattern: /\bnew\s+Function\b/ }
];

export function staticCheck(task, files) {
  const violations = [];
  let totalBytes = 0;
  for (const [relative, content] of Object.entries(files)) {
    totalBytes += Buffer.byteLength(content, "utf8");
    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(content)) {
        violations.push(`${relative}: ${rule.label}`);
      }
    }
    if (content.length > task.maxFileBytes) {
      violations.push(`${relative}: file exceeds ${task.maxFileBytes} bytes`);
    }
  }

  const sizePenalty = totalBytes > task.maxFileBytes * 1.5 ? 0.1 : 0;
  const quality = clamp(1 - violations.length * 0.25 - sizePenalty, 0, 1);
  return { quality, violations, totalBytes };
}

export function parseBenchmarkMs(output, fallbackMs) {
  const text = String(output ?? "");
  const match = text.match(/"(?:ms|elapsedMs|timeMs)"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (match) {
    return Number(match[1]);
  }
  return fallbackMs;
}

export function performanceScore(benchmark, benchMs) {
  if (!benchmark || !Number.isFinite(benchMs)) {
    return 0;
  }
  if (benchMs <= benchmark.targetMs) {
    return 1;
  }
  if (benchMs >= benchmark.maxMs) {
    return 0;
  }
  return clamp((benchmark.maxMs - benchMs) / (benchmark.maxMs - benchmark.targetMs), 0, 1);
}

function benchmarkRunCount(task, runsOverride) {
  const requestedRuns = Number(runsOverride ?? task.benchmark.runs);
  return Number.isFinite(requestedRuns)
    ? Math.max(1, Math.floor(requestedRuns))
    : task.benchmark.runs;
}

async function runBenchmark(task, sandbox, runsOverride) {
  if (!task.benchmark) {
    return { runs: [], benchMs: undefined, score: 0 };
  }

  const runs = [];
  const runCount = benchmarkRunCount(task, runsOverride);
  const timeoutMs = task.benchmark.timeoutMs ?? task.timeoutMs;
  for (let index = 0; index < runCount; index += 1) {
    const result = await runCommand(task.benchmark.command, {
      cwd: sandbox.root,
      timeoutMs,
      env: buildEvaluationEnv()
    });
    if (!result.timedOut && result.code === 0) {
      runs.push(parseBenchmarkMs(result.stdout, result.durationMs));
    }
  }

  const benchMs = median(runs);
  return {
    runs,
    benchMs,
    score: performanceScore(task.benchmark, benchMs)
  };
}

// Measure the candidate and the current best in alternating rounds so CPU
// frequency drift and sandbox position affect both sides equally. An odd
// number of rounds is rounded up to an even one so each side starts half the
// rounds; the median then compares like with like.
async function interleavedBenchmark(task, candidateSandbox, bestFiles, runsOverride) {
  const runCount = benchmarkRunCount(task, runsOverride);
  const rounds = Number.isFinite(runCount) ? (runCount % 2 === 0 ? runCount : runCount + 1) : runCount;
  const timeoutMs = task.benchmark.timeoutMs ?? task.timeoutMs;
  const samples = { candidate: [], best: [] };
  const pairs = [];
  const bestSandbox = await createSandbox(task);
  try {
    await applyFiles(bestSandbox.workspaceDir, validateProposal(task, bestFiles));
    const sandboxes = { candidate: candidateSandbox, best: bestSandbox };
    for (let round = 0; round < rounds; round += 1) {
      const order = round % 2 === 0 ? ["candidate", "best"] : ["best", "candidate"];
      const roundMs = {};
      for (const name of order) {
        const result = await runCommand(task.benchmark.command, {
          cwd: sandboxes[name].root,
          timeoutMs,
          env: buildEvaluationEnv()
        });
        if (!result.timedOut && result.code === 0) {
          const benchMs = parseBenchmarkMs(result.stdout, result.durationMs);
          samples[name].push(benchMs);
          roundMs[name] = benchMs;
        }
      }
      if (Number.isFinite(roundMs.candidate) && Number.isFinite(roundMs.best)) {
        pairs.push({ candidateMs: roundMs.candidate, bestMs: roundMs.best });
      }
    }
  } finally {
    await cleanupSandbox(bestSandbox);
  }

  const candidateMs = median(samples.candidate);
  const bestMs = median(samples.best);
  const comparison = {
    runs: samples.best,
    benchMs: bestMs,
    score: performanceScore(task.benchmark, bestMs),
    pairs
  };
  // Paired ratios cancel drift within a round much better than comparing two
  // medians. Require at least three complete rounds before trusting them.
  if (pairs.length >= 3) {
    const pairedRatio = median(pairs.map((pair) => pair.candidateMs / pair.bestMs));
    const pairedDeltaMs = median(pairs.map((pair) => pair.bestMs - pair.candidateMs));
    if (Number.isFinite(pairedRatio) && Number.isFinite(pairedDeltaMs)) {
      comparison.pairedRatio = pairedRatio;
      comparison.pairedDeltaMs = pairedDeltaMs;
      comparison.pairedWins = pairs.filter((pair) => pair.candidateMs < pair.bestMs).length;
      comparison.pairedRounds = pairs.length;
    }
  }

  return {
    runs: samples.candidate,
    benchMs: candidateMs,
    score: performanceScore(task.benchmark, candidateMs),
    comparison
  };
}

// A standalone interleaved comparison used to confirm a performance win
// without re-running the public and hidden tests.
export async function compareBenchmarks(task, candidateFiles, bestFiles, runsOverride) {
  if (!task.benchmark) {
    throw new Error("compareBenchmarks requires a task with a benchmark.");
  }
  const files = validateProposal(task, candidateFiles);
  const sandbox = await createSandbox(task);
  try {
    await applyFiles(sandbox.workspaceDir, files);
    return await interleavedBenchmark(task, sandbox, bestFiles, runsOverride);
  } finally {
    await cleanupSandbox(sandbox);
  }
}

export async function evaluateTask(task, options = {}) {
  const startedAt = Date.now();
  const requestedFiles = options.files ?? {};
  let sandbox;
  try {
    const files = validateProposal(task, requestedFiles);
    sandbox = await createSandbox(task);
    await applyFiles(sandbox.workspaceDir, files);

    const staticResult = staticCheck(task, files);
    if (staticResult.violations.length) {
      const message = `Static policy check rejected the proposal: ${staticResult.violations.join("; ")}`;
      return {
        taskId: task.id,
        score: task.weights.quality * staticResult.quality,
        correctness: 0,
        hiddenPassRate: 0,
        publicPassRate: 0,
        performance: 0,
        benchMs: undefined,
        benchmarkRuns: [],
        quality: staticResult.quality,
        violations: staticResult.violations,
        publicResult: { total: 0, passed: 0, failed: 0, failures: [message], parsed: false },
        hiddenResult: { total: 0, passed: 0, failed: 0, failures: [message], parsed: false },
        durationMs: Date.now() - startedAt,
        error: message
      };
    }

    const publicCommand = await runCommand(task.testCommand, {
      cwd: sandbox.root,
      timeoutMs: task.timeoutMs,
      env: buildEvaluationEnv()
    });
    const publicResult = testResultFromCommand(publicCommand, "public tests");

    const hiddenDir = path.join(sandbox.root, "hidden");
    await copyDir(task.hiddenTestsDir, hiddenDir);
    const hiddenCommand = await runCommand(task.hiddenCommand, {
      cwd: hiddenDir,
      timeoutMs: task.timeoutMs,
      env: buildEvaluationEnv()
    });
    const hiddenResult = testResultFromCommand(hiddenCommand, "hidden tests");

    const benchmark = options.measureBenchmark === false
      ? { runs: [], benchMs: undefined, score: 0 }
      : options.compareFiles && task.benchmark
        ? await interleavedBenchmark(task, sandbox, options.compareFiles, options.benchmarkRuns)
        : await runBenchmark(task, sandbox, options.benchmarkRuns);

    const hiddenPassRate = hiddenResult.total ? hiddenResult.passed / hiddenResult.total : 0;
    const publicPassRate = publicResult.total ? publicResult.passed / publicResult.total : 0;
    const correctness = hiddenPassRate;
    const score =
      task.weights.correctness * correctness +
      task.weights.performance * benchmark.score +
      task.weights.quality * staticResult.quality;

    return {
      taskId: task.id,
      score,
      correctness,
      hiddenPassRate,
      publicPassRate,
      performance: benchmark.score,
      benchMs: benchmark.benchMs,
      benchmarkRuns: benchmark.runs,
      benchmarkComparison: benchmark.comparison,
      quality: staticResult.quality,
      violations: staticResult.violations,
      publicResult,
      hiddenResult,
      durationMs: Date.now() - startedAt,
      error: undefined
    };
  } catch (error) {
    return {
      taskId: task.id,
      score: 0,
      correctness: 0,
      hiddenPassRate: 0,
      publicPassRate: 0,
      performance: 0,
      benchMs: undefined,
      benchmarkRuns: [],
      quality: 0,
      violations: [],
      publicResult: { total: 0, passed: 0, failed: 0, failures: [], parsed: false },
      hiddenResult: { total: 0, passed: 0, failed: 0, failures: [], parsed: false },
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (sandbox) {
      await cleanupSandbox(sandbox);
    }
  }
}

export function summarizeEvaluation(evaluation) {
  return {
    score: Number(evaluation.score.toFixed(4)),
    correctness: Number(evaluation.correctness.toFixed(4)),
    hidden: `${evaluation.hiddenResult.passed}/${evaluation.hiddenResult.total}`,
    public: `${evaluation.publicResult.passed}/${evaluation.publicResult.total}`,
    performance: Number(evaluation.performance.toFixed(4)),
    benchMs: evaluation.benchMs === undefined ? null : Math.round(evaluation.benchMs),
    runs: evaluation.benchmarkRuns?.length ?? 0,
    referenceBenchMs:
      evaluation.benchmarkComparison?.benchMs === undefined
        ? null
        : Math.round(evaluation.benchmarkComparison.benchMs),
    referenceRuns: evaluation.benchmarkComparison?.runs?.length ?? 0,
    pairedRatio: Number.isFinite(evaluation.benchmarkComparison?.pairedRatio)
      ? Number(evaluation.benchmarkComparison.pairedRatio.toFixed(4))
      : null,
    pairedDeltaMs: Number.isFinite(evaluation.benchmarkComparison?.pairedDeltaMs)
      ? Math.round(evaluation.benchmarkComparison.pairedDeltaMs * 100) / 100
      : null,
    pairedWins: evaluation.benchmarkComparison?.pairedWins ?? null,
    pairedRounds: evaluation.benchmarkComparison?.pairedRounds ?? null,
    quality: Number(evaluation.quality.toFixed(4)),
    violations: evaluation.violations,
    error: evaluation.error,
    failures: evaluation.hiddenResult.failures,
    durationMs: evaluation.durationMs
  };
}

export { buildEvaluationEnv };
