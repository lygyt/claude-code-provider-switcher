import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathExists, truncate } from "./util.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const promptsDir = path.resolve(moduleDir, "..", "prompts");

export async function loadPromptTemplate(nameOrPath) {
  const candidates = [
    path.resolve(nameOrPath),
    path.join(promptsDir, nameOrPath),
    path.join(promptsDir, `${nameOrPath}.md`)
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return fs.readFile(candidate, "utf8");
    }
  }
  throw new Error(`Prompt template not found: ${nameOrPath}`);
}

export function renderTemplate(template, variables) {
  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

export function formatFiles(files) {
  return Object.entries(files)
    .map(([relative, content]) => {
      const extension = path.extname(relative).replace(".", "") || "text";
      return `### ${relative}\n\n\`\`\`${extension}\n${truncate(content, 16000)}\n\`\`\``;
    })
    .join("\n\n");
}

export function formatLessons(lessons) {
  if (!lessons.length) {
    return "(no lessons yet)";
  }
  return lessons
    .map((lesson, index) => {
      const meta = lesson.accepted ? "accepted" : "rejected";
      const delta = typeof lesson.scoreDelta === "number" ? `, delta ${lesson.scoreDelta.toFixed(3)}` : "";
      return `${index + 1}. [${meta}${delta}] ${lesson.lesson}`;
    })
    .join("\n");
}

export function formatPublicResult(result) {
  const header = `Public tests: ${result.passed}/${result.total} passed.`;
  if (!result.failures.length) {
    return `${header}\n${truncate(result.output ?? "", 3000)}`;
  }
  return `${header}\nFailures:\n${result.failures.map((failure) => `- ${failure}`).join("\n")}\n\n${truncate(result.output ?? "", 3000)}`;
}

export function formatHiddenSummary(result) {
  return `Hidden tests (aggregate only; source is unavailable): ${result.passed}/${result.total} passed. Failing checks: ${
    result.failures.length ? result.failures.join("; ") : "none"
  }`;
}

function formatReferenceCheck(evaluation) {
  const referenceMs = Math.round(evaluation.referenceBenchMs);
  const rounds = Number.isFinite(evaluation.referenceRounds)
    ? evaluation.referenceRounds
    : Number.isFinite(evaluation.referenceRuns)
      ? evaluation.referenceRuns
      : 0;
  const roundsText =
    rounds > 0 ? `${rounds} alternating round${rounds === 1 ? "" : "s"}` : "alternating rounds";
  const performance = Number.isFinite(evaluation.referencePerformance)
    ? `; performance score ${evaluation.referencePerformance.toFixed(3)}`
    : "";
  const candidate = Number.isFinite(evaluation.latestCandidateMs)
    ? ` The last candidate measured ${Math.round(evaluation.latestCandidateMs)}ms.`
    : "";
  const speedupPercent = Number.isFinite(evaluation.minSpeedup)
    ? Math.round(evaluation.minSpeedup * 100)
    : 5;
  const absoluteMs = Number.isFinite(evaluation.minSpeedupMs) ? evaluation.minSpeedupMs : 0.5;
  const wins =
    Number.isFinite(evaluation.referenceRounds) && evaluation.referenceRounds > 0
      ? `, and win at least ${Math.ceil((evaluation.referenceRounds * 5) / 6)} of ${evaluation.referenceRounds} paired rounds`
      : "";
  return (
    `Latest interleaved check: the current best measured ${referenceMs}ms median over ${roundsText}${performance}.` +
    `${candidate} An equal-score replacement must be at least ${speedupPercent}% and ${absoluteMs}ms faster${wins}, then reproduce the win in a second comparison.`
  );
}

export function formatBenchmarkResult(benchmark, evaluation = {}) {
  if (!benchmark) {
    return "(no benchmark)";
  }
  const target = benchmark.targetMs ?? "n/a";
  const max = benchmark.maxMs ?? "n/a";
  if (!Number.isFinite(evaluation.benchMs)) {
    return `Benchmark: no successful run (target ${target}ms, max ${max}ms).`;
  }
  const milliseconds = Math.round(evaluation.benchMs);
  const runs =
    Array.isArray(evaluation.benchmarkRuns) && evaluation.benchmarkRuns.length
      ? `; runs [${evaluation.benchmarkRuns.map((run) => Math.round(run)).join(", ")}] ms`
      : "";
  const performance = Number.isFinite(evaluation.performance)
    ? evaluation.performance.toFixed(3)
    : "n/a";
  const lines = [
    `Benchmark: ${milliseconds}ms median${runs}; target ${target}ms, max ${max}ms; ${
      evaluation.benchMs <= target ? "target met" : "misses target"
    }; performance score ${performance}. Lower median time is better when correctness is equal.`
  ];
  // After a rejected comparison the accepted median may be stale. Tell the
  // proposer what the current best measures on this machine right now and
  // exactly what the paired gate requires.
  if (Number.isFinite(evaluation.referenceBenchMs)) {
    lines.push(formatReferenceCheck(evaluation));
  }
  return lines.join("\n\n");
}

export function buildProposalPrompt(task, request, template) {
  return renderTemplate(template, {
    TASK_ID: task.id,
    TASK_TITLE: task.title,
    TASK_PROMPT: task.prompt,
    EDITABLE_PATHS: task.editable.map((file) => `\`${file}\``).join(", "),
    BEST_FILES: formatFiles(request.bestFiles),
    WORKSPACE_TREE: request.workspaceTree.map((file) => `- ${file}`).join("\n"),
    PUBLIC_RESULT: formatPublicResult(request.publicResult),
    HIDDEN_SUMMARY: formatHiddenSummary(request.hiddenResult),
    BENCHMARK_RESULT: formatBenchmarkResult(task.benchmark, {
      benchMs: request.benchMs,
      performance: request.performance,
      benchmarkRuns: request.benchmarkRuns,
      referenceBenchMs: request.referenceBenchMs,
      referenceRuns: request.referenceRuns,
      referenceRounds: request.referenceRounds,
      referencePerformance: request.referencePerformance,
      latestCandidateMs: request.latestCandidateMs,
      minSpeedup: request.minSpeedup,
      minSpeedupMs: request.minSpeedupMs
    }),
    LESSONS: formatLessons(request.lessons ?? []),
    PREVIOUS_FAILURES: request.previousFailures?.length
      ? request.previousFailures.map((failure) => `- ${failure}`).join("\n")
      : "(none)",
    ITERATION: request.iteration,
    MAX_ITERATIONS: request.maxIterations,
    BEST_SCORE: request.bestScore === undefined ? "n/a" : request.bestScore.toFixed(4)
  });
}
