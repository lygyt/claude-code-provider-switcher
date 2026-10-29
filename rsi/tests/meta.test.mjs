import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMetaPrompt,
  runMeta,
  ScriptedMetaProposer,
  validateMetaPrompt
} from "../src/meta.mjs";
import { findTask } from "../src/task.mjs";
import { ScriptedProposer } from "../src/proposers.mjs";
import { loadPromptTemplate } from "../src/prompts.mjs";
import { readCurrentEditable } from "../src/workspace.mjs";
import { referenceSolutions } from "../benchmarks/reference-solutions.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rsiRoot = path.resolve(testsDir, "..");
const benchmarksRoot = path.join(rsiRoot, "benchmarks");

test("buildMetaPrompt renders the maintained meta template", async () => {
  const metaTemplate = await loadPromptTemplate("meta.v1.md");
  const currentTemplate = await loadPromptTemplate("proposer.v1.md");
  const prompt = buildMetaPrompt(
    currentTemplate,
    [{ task: "algorithms/interval-merge", baseline: 0.65, best: 1 }],
    [{ lesson: "Sort first.", accepted: true, scoreDelta: 0.3 }],
    metaTemplate
  );
  assert.match(prompt, /meta-optimizer/);
  assert.match(prompt, /Sort first\./);
  assert.match(prompt, /algorithms\/interval-merge/);
  assert.ok(prompt.includes(currentTemplate.trim().slice(0, 80)));
  assert.ok(!prompt.includes("{{CURRENT_TEMPLATE}}"));
  assert.ok(!prompt.includes("{{VALIDATION_RESULTS}}"));
  assert.ok(!prompt.includes("{{CURRENT_LENGTH}}"));
  assert.ok(prompt.includes(String(currentTemplate.length)));
});

test("buildMetaPrompt requires a template", () => {
  assert.throws(() => buildMetaPrompt("current", [], [], undefined), /requires a meta prompt template/);
});

test("validateMetaPrompt enforces length and required placeholders", async () => {
  const valid = await loadPromptTemplate("proposer.v1.md");
  assert.equal(validateMetaPrompt(valid), valid.trim());
  assert.throws(() => validateMetaPrompt("too short"), /too short/);
  assert.throws(() => validateMetaPrompt(valid.replace("{{BEST_SCORE}}", "")), /BEST_SCORE/);
  assert.throws(() => validateMetaPrompt(valid.replace("{{BENCHMARK_RESULT}}", "")), /BENCHMARK_RESULT/);
  assert.throws(() => validateMetaPrompt(`${valid}\n${"x".repeat(30000)}`), /30000/);
});

test("runMeta accepts a template only when validation scores improve", async () => {
  const task = await findTask(benchmarksRoot, "interval-merge");
  const baselineFiles = await readCurrentEditable(task);
  const baseTemplate = await loadPromptTemplate("proposer.v1.md");
  const magicTemplate = `${baseTemplate}\n<!-- MAGIC_MARKER -->\n`;

  const proposerFactory = async () =>
    new ScriptedProposer((request) => {
      const useReference = request.prompt.includes("MAGIC_MARKER");
      return {
        files: useReference ? referenceSolutions[task.id] : baselineFiles,
        rationale: useReference ? "use the reference algorithm" : "unchanged",
        lessons: []
      };
    });

  const metaProposer = new ScriptedMetaProposer([
    { prompt: magicTemplate, rationale: "Added a marker that changes proposer behavior." }
  ]);
  const result = await runMeta({
    tasks: [task],
    proposerFactory,
    metaProposer,
    rounds: 1,
    maxIterations: 1,
    measureBenchmark: false,
    measureBaselineBenchmark: false
  });

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].accepted, true);
  assert.ok(result.history[0].after > result.history[0].before);
  assert.ok(result.template.includes("MAGIC_MARKER"));
  assert.ok(Math.abs(result.baseline.meanScore - 0.8) < 1e-9);
});

test("runMeta accepts a shorter template when every task score is preserved", async () => {
  const task = await findTask(benchmarksRoot, "interval-merge");
  const baseTemplate = await loadPromptTemplate("proposer.v1.md");
  const compactTemplate = `COMPACT_MARKER
You are the proposer in a recursive self-improvement loop.
Return only JSON with files, rationale, and lessons.
Task:
{{TASK_PROMPT}}
Editable paths: {{EDITABLE_PATHS}}
Iteration {{ITERATION}} of {{MAX_ITERATIONS}}; best score {{BEST_SCORE}}.
Current best files:
{{BEST_FILES}}
Public result:
{{PUBLIC_RESULT}}
Hidden result:
{{HIDDEN_SUMMARY}}
Benchmark:
{{BENCHMARK_RESULT}}
Relevant lessons:
{{LESSONS}}
Previous failures:
{{PREVIOUS_FAILURES}}
Write complete files, fix the cited failures, generalize beyond the public tests, and do not hard-code inputs.
`;
  assert.ok(compactTemplate.trim().length < baseTemplate.trim().length * 0.9);

  const proposerFactory = async () =>
    new ScriptedProposer([{ files: referenceSolutions[task.id], rationale: "reference", lessons: [] }]);
  const metaProposer = new ScriptedMetaProposer([{ prompt: compactTemplate, rationale: "Removed redundant prose." }]);

  const result = await runMeta({
    tasks: [task],
    proposerFactory,
    metaProposer,
    rounds: 1,
    maxIterations: 1,
    measureBenchmark: false,
    measureBaselineBenchmark: false
  });

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].accepted, true);
  assert.equal(result.history[0].reason, "cost");
  assert.ok(result.history[0].costReduction >= 0.1);
  assert.ok(result.template.includes("COMPACT_MARKER"));
  assert.ok(Math.abs(result.baseline.meanScore - 0.8) < 1e-9);
});

test("runMeta rejects malformed templates without changing the current one", async () => {
  const task = await findTask(benchmarksRoot, "interval-merge");
  const baselineFiles = await readCurrentEditable(task);
  const proposerFactory = async () =>
    new ScriptedProposer([{ files: baselineFiles, rationale: "unchanged", lessons: [] }]);
  const metaProposer = new ScriptedMetaProposer([{ prompt: "too short", rationale: "bad" }]);

  const result = await runMeta({
    tasks: [task],
    proposerFactory,
    metaProposer,
    rounds: 1,
    maxIterations: 1,
    measureBenchmark: false,
    measureBaselineBenchmark: false
  });

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].accepted, false);
  assert.match(result.history[0].error, /too short/);
  assert.ok(!result.template.includes("too short"));
  assert.match(result.template, /You are the proposer/);
});
