import { compareBenchmarks, evaluateTask, summarizeEvaluation } from "./evaluator.mjs";
import { summarizeFailure } from "./memory.mjs";
import { buildProposalPrompt, loadPromptTemplate } from "./prompts.mjs";
import { readCurrentEditable, validateProposal } from "./workspace.mjs";
import { walkFiles } from "./util.mjs";

function round(value) {
  return Number(value.toFixed(4));
}

function renderReport(task, result) {
  const startedFromArchive = result.startSource === "archive";
  const lines = [
    `# RSI report: ${task.title}`,
    "",
    `- Task: \`${task.id}\``,
    `- Category: ${task.category}`,
    startedFromArchive
      ? `- Starting score (archived best): ${round(result.baseline.score)}`
      : `- Baseline score: ${round(result.baseline.score)}`,
    `- Best score: ${round(result.best.score)}`,
    `- Accepted iterations: ${result.history.filter((entry) => entry.accepted).length}/${result.history.length}`,
    "",
    "## Iterations",
    "",
    "| # | Score | Hidden | Public | Bench ms | Accepted | Rationale |",
    "|---|-------|--------|--------|----------|----------|-----------|"
  ];

  for (const entry of result.history) {
    const evaluation = entry.evaluation;
    const hidden = evaluation ? `${evaluation.hiddenResult.passed}/${evaluation.hiddenResult.total}` : "n/a";
    const publicResult = evaluation ? `${evaluation.publicResult.passed}/${evaluation.publicResult.total}` : "n/a";
    const bench = evaluation?.benchMs === undefined ? "n/a" : Math.round(evaluation.benchMs);
    const rationale = (entry.rationale || entry.error || "").replace(/\|/g, "\\|").slice(0, 160);
    const accepted = entry.accepted
      ? entry.reason === "performance"
        ? "yes (perf)"
        : "yes (score)"
      : "no";
    lines.push(
      `| ${entry.iteration} | ${evaluation ? round(evaluation.score) : "n/a"} | ${hidden} | ${publicResult} | ${bench} | ${accepted} | ${rationale} |`
    );
  }

  lines.push("", "## Best metrics", "", "```json", JSON.stringify(summarizeEvaluation(result.best), null, 2), "```", "");
  lines.push("## Best files", "", ...Object.keys(result.bestFiles).map((file) => `- \`${file}\``), "");
  return lines.join("\n");
}

export function acceptanceDecision({
  candidate,
  best,
  comparison,
  minDelta = 0.01,
  optimizePerformance = false,
  minSpeedup = 0.05,
  minSpeedupMs = 0.5
}) {
  const speedup = Math.min(1, Math.max(0, Number(minSpeedup) || 0));
  const absoluteSpeedup = Math.max(0, Number(minSpeedupMs) || 0);
  const hiddenNotWorse = candidate.hiddenPassRate >= best.hiddenPassRate - 1e-9;
  const scoreImproved = candidate.score > best.score + minDelta && hiddenNotWorse;
  // Per-round differences cancel CPU drift far better than two medians taken
  // from separate sample sets. Fall back to the medians when the evaluator
  // could not pair at least three rounds.
  const paired =
    comparison &&
    Number.isFinite(comparison.pairedRatio) &&
    Number.isFinite(comparison.pairedDeltaMs) &&
    Number.isFinite(comparison.pairedWins) &&
    Number.isFinite(comparison.pairedRounds);
  const relativeWin = paired
    ? comparison.pairedRatio < 1 - speedup
    : candidate.benchMs < best.benchMs * (1 - speedup);
  const absoluteWin = paired
    ? comparison.pairedDeltaMs >= absoluteSpeedup - 1e-9
    : best.benchMs - candidate.benchMs >= absoluteSpeedup - 1e-9;
  // A genuine speedup wins nearly every paired round; a noise-level "win"
  // wins only a bare majority and should not replace the best solution.
  const decisive = paired
    ? comparison.pairedWins >= Math.ceil(comparison.pairedRounds * (5 / 6))
    : true;
  const performanceImproved =
    Boolean(optimizePerformance) &&
    hiddenNotWorse &&
    candidate.score >= best.score - 1e-9 &&
    Number.isFinite(candidate.benchMs) &&
    Number.isFinite(best.benchMs) &&
    relativeWin &&
    absoluteWin &&
    decisive;

  return {
    accepted: scoreImproved || performanceImproved,
    reason: scoreImproved ? "score" : performanceImproved ? "performance" : "rejected"
  };
}

function scoreWithPerformance(task, evaluation, performance) {
  return (
    task.weights.correctness * evaluation.hiddenPassRate +
    task.weights.performance * performance +
    task.weights.quality * evaluation.quality
  );
}

function coreScore(task, evaluation) {
  return scoreWithPerformance(task, evaluation, 0);
}

// The candidate's benchmark is measured in alternating rounds with the current
// best. Recompute the best's score from that same comparison so a performance
// decision never compares medians taken at different points in time.
function comparisonReference(task, best, comparison) {
  if (!comparison || !Number.isFinite(comparison.benchMs)) {
    return best;
  }
  const performance = comparison.score;
  return {
    ...best,
    benchMs: comparison.benchMs,
    benchmarkRuns: comparison.runs,
    performance,
    score: scoreWithPerformance(task, best, performance)
  };
}

function withBenchmark(task, evaluation, benchmark) {
  return {
    ...evaluation,
    performance: benchmark.score,
    benchMs: benchmark.benchMs,
    benchmarkRuns: benchmark.runs,
    benchmarkComparison: benchmark.comparison,
    score: scoreWithPerformance(task, evaluation, benchmark.score)
  };
}

export async function runTask(task, options = {}) {
  const proposer = options.proposer;
  if (!proposer) {
    throw new Error("runTask requires a proposer.");
  }

  const maxIterations = Number(options.maxIterations ?? 3);
  const minDelta = Number(options.minDelta ?? 0.01);
  const targetScore = Number(options.targetScore ?? 0.98);
  const optimizePerformance = Boolean(options.optimizePerformance && task.benchmark);
  const minSpeedup = Number(options.minSpeedup ?? 0.05);
  const minSpeedupMs = Number(options.minSpeedupMs ?? 0.5);
  const benchmarkRuns = optimizePerformance
    ? Math.max(5, task.benchmark?.runs ?? 0)
    : undefined;
  const template = options.promptTemplate ?? (await loadPromptTemplate("proposer.v1.md"));
  const archive = options.archive;
  const lessonStore = options.lessonStore;
  const onProgress = options.onProgress;

  // Continuation runs start from the archived best, not the weak workspace.
  // This preserves work across invocations and, more importantly, gives the
  // performance gate a real reference immediately: the archived solution is
  // measured under the current workload before the first proposal. An absent
  // or invalid archive falls back to the workspace baseline.
  let baselineFiles;
  let startSource = "workspace";
  if (options.resume && archive) {
    const archivedFiles = await archive.readBest(task.id, task.editable);
    if (archivedFiles) {
      try {
        baselineFiles = validateProposal(task, archivedFiles);
        startSource = "archive";
      } catch {
        baselineFiles = undefined;
      }
    }
  }
  if (!baselineFiles) {
    baselineFiles = await readCurrentEditable(task);
  }
  const baseline = await evaluateTask(task, {
    files: baselineFiles,
    measureBenchmark: options.measureBaselineBenchmark !== false,
    benchmarkRuns
  });
  let best = baseline;
  let bestFiles = baselineFiles;
  const history = [];
  let previousFailures = [];
  // A rejected interleaved comparison still measured the current best on this
  // machine. Carry that fresh reference into the next prompt so the proposer
  // targets the real number rather than the last accepted median.
  let latestReference;
  const workspaceTree = await walkFiles(task.workspaceDir);

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (best.score >= targetScore && !optimizePerformance) {
      break;
    }

    const lessons = lessonStore ? await lessonStore.retrieve(task, 6) : [];
    const request = {
      taskId: task.id,
      task,
      iteration,
      maxIterations,
      bestFiles,
      bestScore: best.score,
      benchMs: best.benchMs,
      performance: best.performance,
      benchmarkRuns: best.benchmarkRuns,
      referenceBenchMs: latestReference?.benchMs,
      referenceRuns: latestReference?.runs?.length,
      referenceRounds: latestReference?.rounds,
      referencePerformance: latestReference?.performance,
      latestCandidateMs: latestReference?.candidateMs,
      minSpeedup,
      minSpeedupMs,
      workspaceTree,
      publicResult: best.publicResult,
      hiddenResult: best.hiddenResult,
      lessons,
      previousFailures
    };
    request.prompt = buildProposalPrompt(task, request, template);

    let proposal;
    try {
      proposal = await proposer.propose(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry = { iteration, accepted: false, error: message, rationale: "", evaluation: undefined };
      history.push(entry);
      previousFailures = [...previousFailures, `Proposer error: ${message}`].slice(-5);
      if (archive) {
        await archive.record(task.id, { iteration, accepted: false, error: message });
      }
      if (onProgress) {
        onProgress({ iteration, best, accepted: false, error: message });
      }
      continue;
    }

    let normalizedFiles;
    try {
      normalizedFiles = validateProposal(task, proposal.files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry = { iteration, accepted: false, error: message, rationale: proposal.rationale, evaluation: undefined };
      history.push(entry);
      previousFailures = [...previousFailures, `Invalid proposal: ${message}`].slice(-5);
      if (archive) {
        await archive.record(task.id, { iteration, accepted: false, error: message });
      }
      if (onProgress) {
        onProgress({ iteration, best, accepted: false, error: message });
      }
      continue;
    }

    const benchmarkEnabled = options.measureBenchmark !== false;
    // Interleaving needs a best solution whose benchmark actually completed;
    // a baseline that times out cannot establish a performance reference.
    const compareBenchmark =
      optimizePerformance && benchmarkEnabled && Number.isFinite(best.benchMs);
    let candidate = await evaluateTask(task, {
      files: normalizedFiles,
      benchmarkRuns,
      measureBenchmark: benchmarkEnabled,
      compareFiles: compareBenchmark ? bestFiles : undefined
    });
    const reference = comparisonReference(task, best, candidate.benchmarkComparison);
    let previousBestScore = reference.score;
    let decision = acceptanceDecision({
      candidate,
      best: reference,
      comparison: candidate.benchmarkComparison,
      minDelta,
      optimizePerformance,
      minSpeedup,
      minSpeedupMs
    });
    // A score gain can also be benchmark-driven when correctness and quality
    // did not change. Any benchmark-driven acceptance must reproduce.
    const benchmarkDriven =
      decision.reason === "performance" ||
      (decision.reason === "score" &&
        Boolean(candidate.benchmarkComparison) &&
        coreScore(task, candidate) <= coreScore(task, reference) + 1e-9);
    let confirmation;
    if (benchmarkDriven) {
      // Timing noise on a shared machine can produce a one-off 5%-plus win.
      // Require a second independent comparison before replacing the best.
      confirmation = await compareBenchmarks(task, normalizedFiles, bestFiles, benchmarkRuns);
      const confirmedCandidate = withBenchmark(task, candidate, confirmation);
      const confirmedReference = comparisonReference(task, best, confirmation.comparison);
      const confirmed = acceptanceDecision({
        candidate: confirmedCandidate,
        best: confirmedReference,
        comparison: confirmation.comparison,
        minDelta,
        optimizePerformance,
        minSpeedup,
        minSpeedupMs
      });
      const confirmedOk =
        decision.reason === "performance" ? confirmed.reason === "performance" : confirmed.accepted;
      if (confirmedOk) {
        candidate = confirmedCandidate;
        previousBestScore = confirmedReference.score;
      } else {
        decision = { accepted: false, reason: "rejected" };
      }
    }
    const accepted = decision.accepted;

    const entry = {
      iteration,
      accepted,
      reason: decision.reason,
      rationale: proposal.rationale,
      evaluation: candidate,
      lessons: proposal.lessons
    };
    history.push(entry);

    if (accepted) {
      best = candidate;
      bestFiles = normalizedFiles;
      previousFailures = [];
      // The new best carries the fresh candidate-side measurement.
      latestReference = undefined;
    } else {
      const latestComparison = confirmation?.comparison ?? candidate.benchmarkComparison;
      latestReference =
        latestComparison && Number.isFinite(latestComparison.benchMs)
          ? {
              benchMs: latestComparison.benchMs,
              runs: latestComparison.runs,
              rounds: latestComparison.pairedRounds,
              performance: latestComparison.score,
              candidateMs: confirmation ? confirmation.benchMs : candidate.benchMs
            }
          : undefined;
      previousFailures = [
        ...previousFailures,
        summarizeFailure(candidate, task, {
          bestScore: reference.score,
          bestHiddenPassRate: reference.hiddenPassRate,
          bestBenchMs: reference.benchMs,
          optimizePerformance,
          minSpeedup,
          minSpeedupMs,
          confirmationFailed: Boolean(confirmation) && !accepted,
          confirmationCandidateMs: confirmation?.benchMs,
          confirmationBestMs: confirmation?.comparison?.benchMs
        })
      ].slice(-5);
    }

    if (lessonStore) {
      const scoreDelta = candidate.score - previousBestScore;
      for (const lesson of proposal.lessons) {
        await lessonStore.add({
          taskId: task.id,
          tags: [task.category, ...(task.tags ?? [])],
          lesson,
          accepted,
          scoreDelta
        });
      }
    }

    if (archive) {
      await archive.record(task.id, {
        iteration,
        accepted,
        reason: decision.reason,
        score: candidate.score,
        previousBest: previousBestScore,
        summary: summarizeEvaluation(candidate),
        rationale: proposal.rationale,
        lessons: proposal.lessons,
        files: Object.keys(normalizedFiles)
      });
    }

    if (onProgress) {
      onProgress({ iteration, best, accepted, reason: decision.reason, evaluation: candidate });
    }
  }

  const result = {
    task,
    baseline,
    best,
    bestFiles,
    history,
    startSource,
    report: renderReport(task, { baseline, best, bestFiles, history, startSource })
  };

  if (archive) {
    await archive.saveBest(task.id, bestFiles);
    await archive.saveReport(task.id, result.report);
  }

  return result;
}

export async function runSuite(tasks, options = {}) {
  const results = [];
  for (const task of tasks) {
    const proposer = options.proposerFactory ? await options.proposerFactory(task) : options.proposer;
    const result = await runTask(task, { ...options, proposer });
    results.push(result);
  }

  const meanScore = results.length
    ? results.reduce((sum, result) => sum + result.best.score, 0) / results.length
    : 0;
  return {
    results,
    aggregate: {
      tasks: results.length,
      meanScore,
      solved: results.filter((result) => result.best.hiddenPassRate >= 0.999).length,
      improved: results.filter((result) => result.best.score > result.baseline.score + 0.01).length,
      resumed: results.filter((result) => result.startSource === "archive").length,
      performanceImproved: results.filter((result) =>
        result.history.some((entry) => entry.accepted && entry.reason === "performance")
      ).length
    }
  };
}
