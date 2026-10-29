import { compareBenchmarks } from "./evaluator.mjs";
import { median } from "./util.mjs";

// Identical-code calibration: a benchmark workload is trustworthy for the
// performance gate only if comparing a solution against itself does not look
// like a speedup. This mirrors the acceptance conditions that matter for a
// null comparison (correctness and quality are identical by construction).
export function comparisonPasses(comparison, options = {}) {
  if (!comparison) {
    return false;
  }
  const requestedSpeedup = Number(options.minSpeedup);
  const minSpeedup = Number.isFinite(requestedSpeedup)
    ? Math.min(1, Math.max(0, requestedSpeedup))
    : 0.05;
  const requestedMs = Number(options.minSpeedupMs);
  const minSpeedupMs = Number.isFinite(requestedMs) ? Math.max(0, requestedMs) : 0.5;
  const { pairedRatio, pairedDeltaMs, pairedWins, pairedRounds } = comparison;
  if (![pairedRatio, pairedDeltaMs, pairedWins, pairedRounds].every(Number.isFinite)) {
    return false;
  }
  return (
    pairedRatio < 1 - minSpeedup &&
    pairedDeltaMs >= minSpeedupMs - 1e-9 &&
    pairedWins >= Math.ceil(pairedRounds * (5 / 6))
  );
}

// Run independent identical-code trials. A trial is a "confirmed accept" only
// when the first comparison passes and a second, independent comparison also
// passes, which is exactly what runTask requires before replacing the best.
export async function calibrateTask(task, files, options = {}) {
  if (!task.benchmark) {
    return {
      task: task.id,
      skipped: true,
      reason: "no benchmark",
      trials: 0,
      firstStageAccepts: 0,
      confirmedAccepts: 0,
      noisy: false,
      records: []
    };
  }

  const compare = options.compare ?? compareBenchmarks;
  const trialCount = Math.max(1, Math.floor(Number(options.trials ?? 5)));
  const benchmarkRuns = Math.max(
    5,
    Math.floor(Number(options.benchmarkRuns ?? task.benchmark.runs ?? 0))
  );
  const records = [];

  for (let trial = 1; trial <= trialCount; trial += 1) {
    const first = await compare(task, files, files, benchmarkRuns);
    const firstPass = comparisonPasses(first.comparison, options);
    let confirmation;
    let confirmedPass = false;
    if (firstPass) {
      confirmation = await compare(task, files, files, benchmarkRuns);
      confirmedPass = comparisonPasses(confirmation.comparison, options);
    }
    records.push({
      trial,
      firstPass,
      confirmedPass,
      firstBenchMs: first.benchMs,
      first: first.comparison,
      confirmation: confirmation?.comparison
    });
  }

  return {
    task: task.id,
    skipped: false,
    trials: trialCount,
    benchmarkRuns,
    firstStageAccepts: records.filter((record) => record.firstPass).length,
    confirmedAccepts: records.filter((record) => record.confirmedPass).length,
    noisy: records.some((record) => record.confirmedPass),
    records
  };
}

export function calibrateSummary(result) {
  if (result.skipped) {
    return {
      task: result.task,
      skipped: true,
      reason: result.reason,
      trials: result.trials,
      firstStageAccepts: 0,
      confirmedAccepts: 0,
      medianPairedRatio: null,
      meanWinRate: null,
      status: "skipped"
    };
  }
  const ratios = result.records
    .map((record) => record.first?.pairedRatio)
    .filter((value) => Number.isFinite(value));
  const winRates = result.records
    .map((record) =>
      Number.isFinite(record.first?.pairedRounds) && record.first.pairedRounds > 0
        ? record.first.pairedWins / record.first.pairedRounds
        : undefined
    )
    .filter((value) => Number.isFinite(value));
  return {
    task: result.task,
    skipped: false,
    trials: result.trials,
    benchmarkRuns: result.benchmarkRuns,
    firstStageAccepts: result.firstStageAccepts,
    confirmedAccepts: result.confirmedAccepts,
    medianPairedRatio: ratios.length ? Number(median(ratios).toFixed(4)) : null,
    meanWinRate: winRates.length
      ? Number((winRates.reduce((sum, value) => sum + value, 0) / winRates.length).toFixed(4))
      : null,
    status: result.noisy ? "noisy" : "ok"
  };
}
