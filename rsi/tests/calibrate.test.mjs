import test from "node:test";
import assert from "node:assert/strict";
import { calibrateSummary, calibrateTask, comparisonPasses } from "../src/calibrate.mjs";

function comparison(overrides = {}) {
  return {
    pairedRatio: 0.9,
    pairedDeltaMs: 2,
    pairedWins: 5,
    pairedRounds: 6,
    ...overrides
  };
}

test("comparisonPasses mirrors the paired performance gate", () => {
  assert.equal(comparisonPasses(comparison()), true);
  assert.equal(comparisonPasses(comparison({ pairedWins: 4 })), false);
  assert.equal(comparisonPasses(comparison({ pairedRatio: 0.97 })), false);
  assert.equal(comparisonPasses(comparison({ pairedDeltaMs: 0.3 })), false);
  assert.equal(comparisonPasses(comparison({ pairedRounds: 10, pairedWins: 9 })), true);
  assert.equal(comparisonPasses(comparison({ pairedRounds: 10, pairedWins: 8 })), false);
  assert.equal(comparisonPasses({}), false);
  assert.equal(comparisonPasses(undefined), false);
  assert.equal(comparisonPasses(comparison({ pairedRatio: 0.97 }), { minSpeedup: 0.01 }), true);
  assert.equal(
    comparisonPasses(comparison({ pairedDeltaMs: 0.3 }), { minSpeedupMs: 0 }),
    true
  );
});

test("calibrateTask requires two passing comparisons for a noisy verdict", async () => {
  const task = { id: "synthetic/calibration", benchmark: { runs: 2 } };
  const files = { "solution.js": "export const x = 1;\n" };
  const responses = [
    comparison({ pairedWins: 3 }),
    comparison(),
    comparison(),
    comparison(),
    comparison({ pairedWins: 3 })
  ];
  let calls = 0;
  const result = await calibrateTask(task, files, {
    trials: 3,
    compare: async (receivedTask, candidateFiles, bestFiles, runs) => {
      assert.equal(receivedTask, task);
      assert.equal(candidateFiles, files);
      assert.equal(bestFiles, files);
      assert.equal(runs, 5);
      const response = responses[calls];
      calls += 1;
      return { benchMs: 10, runs: [10], comparison: response };
    }
  });

  assert.equal(calls, 5);
  assert.equal(result.firstStageAccepts, 2);
  assert.equal(result.confirmedAccepts, 1);
  assert.equal(result.noisy, true);
  assert.equal(result.benchmarkRuns, 5);

  const summary = calibrateSummary(result);
  assert.equal(summary.status, "noisy");
  assert.equal(summary.medianPairedRatio, 0.9);
  assert.equal(summary.meanWinRate, 0.7222);
});

test("calibrateTask skips tasks without a benchmark", async () => {
  let calls = 0;
  const result = await calibrateTask(
    { id: "synthetic/no-benchmark" },
    {},
    {
      compare: async () => {
        calls += 1;
        throw new Error("should not be called");
      }
    }
  );
  assert.equal(calls, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no benchmark");
  assert.equal(calibrateSummary(result).status, "skipped");
});
