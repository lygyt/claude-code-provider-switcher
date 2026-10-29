import test from "node:test";
import assert from "node:assert/strict";
import { buildProposalPrompt, formatBenchmarkResult, loadPromptTemplate } from "../src/prompts.mjs";

test("formatBenchmarkResult reports the median, target, and status", () => {
  const benchmark = { targetMs: 50, maxMs: 500 };
  const met = formatBenchmarkResult(benchmark, {
    benchMs: 17.4,
    performance: 1,
    benchmarkRuns: [16, 18.8]
  });
  assert.match(met, /17ms median/);
  assert.match(met, /runs \[16, 19\] ms/);
  assert.match(met, /target 50ms, max 500ms/);
  assert.match(met, /target met/);
  assert.match(met, /performance score 1\.000/);

  const missed = formatBenchmarkResult(benchmark, {
    benchMs: 75,
    performance: 0.5
  });
  assert.match(missed, /75ms median/);
  assert.match(missed, /misses target/);

  assert.match(formatBenchmarkResult(benchmark, {}), /no successful run/);
  assert.equal(formatBenchmarkResult(undefined, {}), "(no benchmark)");
});

test("formatBenchmarkResult reports the latest interleaved reference", () => {
  const benchmark = { targetMs: 50, maxMs: 500 };
  const text = formatBenchmarkResult(benchmark, {
    benchMs: 60,
    performance: 0.8,
    benchmarkRuns: [58, 62],
    referenceBenchMs: 64.4,
    referenceRuns: 6,
    referenceRounds: 6,
    referencePerformance: 0.7,
    latestCandidateMs: 61,
    minSpeedup: 0.05,
    minSpeedupMs: 0.5
  });
  assert.match(text, /Benchmark: 60ms median/);
  assert.match(
    text,
    /Latest interleaved check: the current best measured 64ms median over 6 alternating rounds; performance score 0\.700\./
  );
  assert.match(text, /The last candidate measured 61ms\./);
  assert.match(text, /at least 5% and 0\.5ms faster, and win at least 5 of 6 paired rounds/);
  assert.match(text, /reproduce the win in a second comparison/);
  assert.doesNotMatch(
    formatBenchmarkResult(benchmark, { benchMs: 60, performance: 1 }),
    /Latest interleaved check/
  );
});

test("buildProposalPrompt renders benchmark feedback from the current best", async () => {
  const template = await loadPromptTemplate("proposer.v1.md");
  assert.ok(template.includes("{{BENCHMARK_RESULT}}"));

  const prompt = buildProposalPrompt(
    {
      id: "algorithms/example",
      title: "Example",
      prompt: "Implement f.",
      editable: ["solution.js"],
      benchmark: { targetMs: 50, maxMs: 500 }
    },
    {
      bestFiles: { "solution.js": "export function f() { return 1; }\n" },
      bestScore: 0.8,
      benchMs: 75,
      performance: 0.5,
      benchmarkRuns: [70, 80],
      referenceBenchMs: 79.8,
      referenceRuns: 6,
      referenceRounds: 6,
      referencePerformance: 0.45,
      latestCandidateMs: 76,
      minSpeedup: 0.05,
      minSpeedupMs: 0.5,
      workspaceTree: ["solution.js"],
      publicResult: { passed: 1, total: 1, failures: [], output: "" },
      hiddenResult: { passed: 1, total: 1, failures: [] },
      lessons: [],
      previousFailures: [],
      iteration: 2,
      maxIterations: 3
    },
    template
  );

  assert.match(prompt, /Benchmark: 75ms median/);
  assert.match(prompt, /target 50ms/);
  assert.match(prompt, /Latest interleaved check: the current best measured 80ms median/);
  assert.match(prompt, /The last candidate measured 76ms\./);
  assert.ok(!prompt.includes("{{BENCHMARK_RESULT}}"));
});
