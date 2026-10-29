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
  assert.ok(!prompt.includes("{{BENCHMARK_RESULT}}"));
});
