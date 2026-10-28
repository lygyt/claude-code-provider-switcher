import { runTask } from "./loop.mjs";
import { loadPromptTemplate, renderTemplate } from "./prompts.mjs";
import { runCommand } from "./evaluator.mjs";
import { childProcessEnv } from "./provider.mjs";
import { extractJsonObject, truncate } from "./util.mjs";
import { withIsolatedDirectory } from "./proposers.mjs";

export function validateMetaPrompt(template) {
  if (typeof template !== "string") {
    throw new Error("Meta proposer must return a string prompt.");
  }
  const trimmed = template.trim();
  if (trimmed.length < 200) {
    throw new Error("Meta prompt is too short to be useful.");
  }
  if (trimmed.length > 30000) {
    throw new Error("Meta prompt exceeds the 30000 character limit.");
  }
  for (const placeholder of [
    "{{TASK_PROMPT}}",
    "{{BEST_FILES}}",
    "{{EDITABLE_PATHS}}",
    "{{PUBLIC_RESULT}}",
    "{{HIDDEN_SUMMARY}}",
    "{{LESSONS}}",
    "{{PREVIOUS_FAILURES}}",
    "{{ITERATION}}",
    "{{MAX_ITERATIONS}}",
    "{{BEST_SCORE}}"
  ]) {
    if (!trimmed.includes(placeholder)) {
      throw new Error(`Meta prompt is missing required placeholder ${placeholder}.`);
    }
  }
  return trimmed;
}

function summarizeResults(results) {
  return results.map((result) => ({
    task: result.task.id,
    baseline: Number(result.baseline.score.toFixed(4)),
    best: Number(result.best.score.toFixed(4)),
    hidden: `${result.best.hiddenResult.passed}/${result.best.hiddenResult.total}`,
    acceptedIterations: result.history.filter((entry) => entry.accepted).length
  }));
}

export function metaDecision({
  previousResults,
  candidateResults,
  previousTemplate,
  candidateTemplate,
  minDelta = 0.01,
  maxRegression = 0.03,
  minCostReduction = 0.1
}) {
  const mean = (results) =>
    results.length ? results.reduce((sum, result) => sum + result.best.score, 0) / results.length : 0;
  const previousMean = mean(previousResults);
  const candidateMean = mean(candidateResults);
  const scoreImproved = candidateMean > previousMean + minDelta;
  const noLargeRegression = candidateResults.every(
    (result, index) => result.best.score >= previousResults[index].best.score - maxRegression
  );
  const scoreAccepted = scoreImproved && noLargeRegression;

  const promptLengthBefore = previousTemplate.length;
  const promptLengthAfter = candidateTemplate.length;
  const costReduction =
    promptLengthBefore > 0 ? (promptLengthBefore - promptLengthAfter) / promptLengthBefore : 0;
  const nonInferior =
    candidateMean >= previousMean - 1e-9 &&
    candidateResults.every(
      (result, index) => result.best.score >= previousResults[index].best.score - 1e-9
    );
  const costAccepted = nonInferior && costReduction >= minCostReduction;

  return {
    accepted: scoreAccepted || costAccepted,
    reason: scoreAccepted ? "score" : costAccepted ? "cost" : "rejected",
    previousMean,
    candidateMean,
    promptLengthBefore,
    promptLengthAfter,
    costReduction
  };
}

async function evaluateTemplate(template, tasks, proposerFactory, options) {
  const results = [];
  for (const task of tasks) {
    const proposer = await proposerFactory(task);
    results.push(
      await runTask(task, {
        ...options,
        proposer,
        promptTemplate: template,
        maxIterations: options.maxIterations ?? 2
      })
    );
  }
  const meanScore = results.length ? results.reduce((sum, result) => sum + result.best.score, 0) / results.length : 0;
  return { results, meanScore };
}

export function buildMetaPrompt(currentTemplate, validationSummary, lessons, metaTemplate, options = {}) {
  if (typeof metaTemplate !== "string" || !metaTemplate.trim()) {
    throw new Error("buildMetaPrompt requires a meta prompt template.");
  }
  const meanScore = validationSummary.length
    ? validationSummary.reduce((sum, result) => sum + result.best, 0) / validationSummary.length
    : 0;
  return renderTemplate(metaTemplate, {
    CURRENT_TEMPLATE: currentTemplate,
    CURRENT_LENGTH: currentTemplate.length,
    CURRENT_MEAN: meanScore.toFixed(4),
    MIN_COST_REDUCTION_PERCENT: Math.round((options.minCostReduction ?? 0.1) * 100),
    VALIDATION_RESULTS: JSON.stringify(validationSummary, null, 2),
    LESSONS: lessons.length ? lessons.map((lesson) => `- ${lesson.lesson}`).join("\n") : "(none)"
  });
}

export class ScriptedMetaProposer {
  constructor(responses) {
    this.responses = Array.isArray(responses) ? [...responses] : responses;
    this.requests = [];
  }

  async proposeMeta(request) {
    this.requests.push(request);
    const response = typeof this.responses === "function" ? await this.responses(request) : this.responses.shift();
    if (response === undefined) {
      throw new Error("ScriptedMetaProposer ran out of responses.");
    }
    return typeof response === "string" ? JSON.parse(response) : response;
  }
}

export class CommandMetaProposer {
  constructor(options = {}) {
    this.command = options.command ?? "claude";
    this.args = options.args ?? ["-p", "--output-format", "text"];
    this.timeoutMs = options.timeoutMs ?? 300000;
    this.provider = options.provider;
    this.cwd = options.cwd;
  }

  async proposeMeta(request) {
    const run = async (cwd) => {
      const result = await runCommand([this.command, ...this.args], {
        cwd,
        timeoutMs: this.timeoutMs,
        env: childProcessEnv(this.provider),
        input: request.prompt,
        windowsShell: true
      });
      if (result.timedOut) {
        throw new Error(`Meta proposer timed out after ${this.timeoutMs}ms.`);
      }
      if (result.code !== 0) {
        throw new Error(`Meta proposer exited with ${result.code}: ${truncate(result.stderr || result.stdout, 1200)}`);
      }
      const value = extractJsonObject(result.stdout);
      if (!value || typeof value.prompt !== "string") {
        throw new Error("Meta proposer did not return a prompt string.");
      }
      return {
        prompt: value.prompt,
        rationale: typeof value.rationale === "string" ? value.rationale : ""
      };
    };

    return this.cwd ? run(this.cwd) : withIsolatedDirectory(run);
  }
}

export async function runMeta(options) {
  const {
    tasks,
    proposerFactory,
    metaProposer,
    rounds = 2,
    minDelta = 0.01,
    maxRegression = 0.03,
    minCostReduction = 0.1,
    lessonStore
  } = options;
  if (!tasks?.length) {
    throw new Error("runMeta requires at least one validation task.");
  }
  if (!proposerFactory || !metaProposer) {
    throw new Error("runMeta requires proposerFactory and metaProposer.");
  }

  let template = options.promptTemplate ?? (await loadPromptTemplate("proposer.v1.md"));
  const metaTemplate = options.metaTemplate ?? (await loadPromptTemplate(options.metaPromptTemplate ?? "meta.v1.md"));
  let baseline = await evaluateTemplate(template, tasks, proposerFactory, options);
  const history = [];

  for (let round = 1; round <= rounds; round += 1) {
    const lessons = lessonStore ? await lessonStore.retrieve({ id: "meta", title: "prompt optimization", category: "meta", tags: ["prompt"] }, 8) : [];
    const prompt = buildMetaPrompt(template, summarizeResults(baseline.results), lessons, metaTemplate, {
      minCostReduction
    });
    let proposal;
    try {
      proposal = await metaProposer.proposeMeta({
        round,
        currentTemplate: template,
        results: summarizeResults(baseline.results),
        meanScore: baseline.meanScore,
        prompt
      });
    } catch (error) {
      history.push({ round, accepted: false, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    let candidateTemplate;
    try {
      candidateTemplate = validateMetaPrompt(proposal.prompt);
    } catch (error) {
      history.push({ round, accepted: false, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const previousMean = baseline.meanScore;
    const candidate = await evaluateTemplate(candidateTemplate, tasks, proposerFactory, options);
    const decision = metaDecision({
      previousResults: baseline.results,
      candidateResults: candidate.results,
      previousTemplate: template,
      candidateTemplate,
      minDelta,
      maxRegression,
      minCostReduction
    });
    history.push({
      round,
      accepted: decision.accepted,
      reason: decision.reason,
      before: Number(previousMean.toFixed(4)),
      after: Number(candidate.meanScore.toFixed(4)),
      rationale: proposal.rationale,
      promptLengthBefore: decision.promptLengthBefore,
      promptLengthAfter: decision.promptLengthAfter,
      costReduction: Number(decision.costReduction.toFixed(4))
    });

    if (decision.accepted) {
      template = candidateTemplate;
      baseline = candidate;
      if (lessonStore) {
        await lessonStore.add({
          taskId: "meta",
          tags: ["meta", "prompt"],
          lesson:
            decision.reason === "cost"
              ? proposal.rationale || "Accepted a shorter prompt template that preserved validation scores."
              : proposal.rationale || "Accepted a prompt template that improved validation scores.",
          accepted: true,
          scoreDelta: candidate.meanScore - previousMean
        });
      }
    }
  }

  return {
    template,
    baseline,
    history
  };
}
