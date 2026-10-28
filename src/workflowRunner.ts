import { DirectChatMessage, DirectChatRole, sendDirectChat } from "./directChat";
import { readSkillInstructions } from "./skillManager";
import {
  ProviderProfile,
  Workflow,
  WorkflowReviewLoop,
  WorkflowReviewLoopRunSummary,
  WorkflowRunResult,
  WorkflowStep,
  WorkflowStepResult
} from "./types";

export const defaultReviewApprovalPattern =
  "(?:^|\\n)\\s*(?:Decision|Verdict|Status|Final decision|最终决定|最终判断|判断|结论)\\s*[:：-]\\s*(?:APPROVED|ACCEPTED|PASS|接受|通过)(?:\\s|$|[。.!])|(?:^|\\n)\\s*(?:APPROVED|ACCEPTED|PASS|接受|通过)\\s*(?:$|\\n)";

export interface WorkflowRunnerProgress {
  /** Reports progress before a step runs. completedSteps/totalSteps is the fraction done. */
  report(step: WorkflowStep, stepIndex: number, totalSteps: number): void;
}

export interface WorkflowRunnerContext {
  /** Resolve the provider profile for a step's providerId. */
  resolveProvider(providerId: string): Promise<ProviderProfile | undefined>;
  /** Resolve the stored API token for a provider. */
  resolveToken(providerId: string): Promise<string | undefined>;
  /** Optional injected fetch (for tests). Defaults to global fetch. */
  fetchImpl?: Parameters<typeof sendDirectChat>[3];
}

/**
 * Renders a step prompt template. Supports:
 *   {{task}}      — the original user task
 *   {{previous}}  — the previous step's output (empty for the first step)
 *   {{input}}     — alias for {{previous}}
 *   {{iteration}} — current review-loop iteration, starting at 1
 *   {{review}}    — latest review feedback, empty before the first review
 *   {{artifact}}  — latest artifact sent to the review step, empty before the first review
 */
export function renderStepPrompt(
  template: string,
  context: { task: string; previous: string; iteration?: number; review?: string; artifact?: string }
): string {
  return template
    .replace(/\{\{\s*task\s*\}\}/gi, context.task)
    .replace(/\{\{\s*(previous|input)\s*\}\}/gi, context.previous)
    .replace(/\{\{\s*iteration\s*\}\}/gi, String(context.iteration ?? 1))
    .replace(/\{\{\s*review\s*\}\}/gi, context.review ?? "")
    .replace(/\{\{\s*artifact\s*\}\}/gi, context.artifact ?? "");
}

export async function runWorkflow(
  workflow: Workflow,
  task: string,
  context: WorkflowRunnerContext,
  progress?: WorkflowRunnerProgress
): Promise<WorkflowRunResult> {
  const steps: WorkflowStepResult[] = [];
  let previous = "";
  let succeeded = true;
  let executedStepCount = 0;

  const resolved = resolveActiveReviewLoops(workflow);
  if (resolved.error) {
    return {
      workflow,
      task,
      steps,
      finalOutput: "",
      succeeded: false,
      reviewLoops: resolved.loops.map((loop) => loop.summary)
    };
  }

  const activeLoops = resolved.loops;
  const loopByReviseFrom = new Map<number, ActiveReviewLoop>();
  const loopByReview = new Map<number, ActiveReviewLoop>();
  for (const loop of activeLoops) {
    loopByReviseFrom.set(loop.reviseFromIndex, loop);
    loopByReview.set(loop.reviewIndex, loop);
  }

  const total = computeProgressTotal(workflow.steps.length, activeLoops);

  let index = 0;
  while (index < workflow.steps.length) {
    const step = workflow.steps[index];

    // Capture the stable upstream context the first time a loop's revise-from step is reached.
    const loopStartingHere = loopByReviseFrom.get(index);
    if (loopStartingHere && !loopStartingHere.entryCaptured) {
      loopStartingHere.loopEntryPrevious = previous;
      loopStartingHere.entryCaptured = true;
    }

    const containingLoop = activeLoops.find((loop) => index >= loop.reviseFromIndex && index <= loop.reviewIndex);
    progress?.report(step, executedStepCount, total);
    executedStepCount += 1;

    const provider = await context.resolveProvider(step.providerId);
    const input = renderStepPrompt(step.prompt, {
      task,
      previous,
      iteration: containingLoop?.iteration ?? 1,
      review: containingLoop?.latestReviewFeedback ?? "",
      artifact: containingLoop?.latestReviewedArtifact ?? ""
    });

    if (!provider) {
      steps.push({
        step,
        providerName: "(missing provider)",
        modelName: step.model || "(unset)",
        loopIteration: containingLoop?.iteration,
        input,
        output: "",
        error: `Provider "${step.providerId}" was not found.`
      });
      succeeded = false;
      break;
    }

    const token = await context.resolveToken(step.providerId);
    const systemPrompt = step.skillDirectory ? await safeReadSkillInstructions(step.skillDirectory) : undefined;
    const messages: DirectChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system" as DirectChatRole, content: systemPrompt });
    }
    messages.push({ role: "user" as DirectChatRole, content: input });
    const previousBeforeStep = previous;

    try {
      // includeReasoning=false: chain only the model's final answer, not its private chain-of-thought,
      // so reasoning noise does not pollute the next step's {{previous}} input.
      const output = await sendDirectChat(provider, token, messages, context.fetchImpl, step.model, false);
      steps.push({
        step,
        providerName: provider.name,
        modelName: step.model || provider.chatModel || provider.model || "(default)",
        skillName: step.skillDirectory ? pathBasename(step.skillDirectory) : undefined,
        loopIteration: containingLoop?.iteration,
        input,
        output
      });

      const loop = loopByReview.get(index);
      if (loop) {
        loop.latestReviewedArtifact = previousBeforeStep;
        loop.latestReviewFeedback = output;
        loop.summary.iterations = loop.iteration;

        if (isReviewApproved(output, loop.summary.approvalPattern)) {
          loop.summary.approved = true;
          // Downstream continues from the approved artifact, not the review text.
          previous = loop.latestReviewedArtifact;
          index += 1;
          continue;
        }

        if (loop.iteration >= loop.summary.maxIterations) {
          // Exhausted: keep the best artifact and let the pipeline continue autonomously.
          loop.summary.exhausted = true;
          previous = loop.latestReviewedArtifact;
          index += 1;
          continue;
        }

        loop.iteration += 1;
        previous = buildRevisionContext({
          task,
          iteration: loop.iteration,
          stableContext: loop.loopEntryPrevious ?? "",
          reviewedArtifact: loop.latestReviewedArtifact,
          reviewFeedback: loop.latestReviewFeedback
        });
        index = loop.reviseFromIndex; // rewind (while-loop will run the revise-from step next)
        continue;
      }

      previous = output;
      index += 1;
    } catch (error) {
      steps.push({
        step,
        providerName: provider.name,
        modelName: step.model || provider.chatModel || provider.model || "(default)",
        skillName: step.skillDirectory ? pathBasename(step.skillDirectory) : undefined,
        loopIteration: containingLoop?.iteration,
        input,
        output: "",
        error: error instanceof Error ? error.message : String(error)
      });
      succeeded = false;
      break;
    }
  }

  return {
    workflow,
    task,
    steps,
    finalOutput: previous,
    succeeded,
    reviewLoops: activeLoops.map((loop) => loop.summary)
  };
}

interface ActiveReviewLoop {
  config: WorkflowReviewLoop;
  reviseFromIndex: number;
  reviewIndex: number;
  summary: WorkflowReviewLoopRunSummary;
  // Per-run mutable state:
  iteration: number;
  latestReviewFeedback: string;
  latestReviewedArtifact: string;
  loopEntryPrevious: string | undefined;
  entryCaptured: boolean;
}

interface ResolvedReviewLoops {
  loops: ActiveReviewLoop[];
  error: string | undefined;
}

function resolveActiveReviewLoops(workflow: Workflow): ResolvedReviewLoops {
  const configs = workflow.reviewLoops?.filter((loop) => loop.enabled) ?? [];
  if (configs.length === 0) {
    return { loops: [], error: undefined };
  }

  const loops: ActiveReviewLoop[] = [];
  for (const config of configs) {
    const approvalPattern = normalizeApprovalPattern(config.approvalPattern);
    const maxIterations = clampMaxIterations(config.maxIterations);
    const reviseFromIndex = workflow.steps.findIndex((step) => step.id === config.reviseFromStepId);
    const reviewIndex = workflow.steps.findIndex((step) => step.id === config.reviewStepId);
    const summary: WorkflowReviewLoopRunSummary = {
      enabled: true,
      approved: false,
      exhausted: false,
      iterations: 0,
      maxIterations,
      reviseFromStepName: reviseFromIndex >= 0 ? workflow.steps[reviseFromIndex].name : undefined,
      reviewStepName: reviewIndex >= 0 ? workflow.steps[reviewIndex].name : undefined,
      approvalPattern,
      error: undefined
    };

    if (reviseFromIndex < 0) {
      summary.error = `Review loop "${config.name ?? config.reviseFromStepId}" revise-from step was not found.`;
      loops.push(makeActiveLoop(config, -1, -1, summary));
      return { loops, error: summary.error };
    }
    if (reviewIndex < 0) {
      summary.error = `Review loop "${config.name ?? config.reviewStepId}" review step was not found.`;
      loops.push(makeActiveLoop(config, reviseFromIndex, -1, summary));
      return { loops, error: summary.error };
    }
    if (reviseFromIndex >= reviewIndex) {
      summary.error = `Review loop "${config.name ?? ""}" revise-from step must come strictly before its review step.`;
      loops.push(makeActiveLoop(config, reviseFromIndex, reviewIndex, summary));
      return { loops, error: summary.error };
    }

    loops.push(makeActiveLoop(config, reviseFromIndex, reviewIndex, summary));
  }

  // Loops must be non-overlapping and ordered. Sort by reviseFromIndex, then verify ranges don't intersect.
  loops.sort((a, b) => a.reviseFromIndex - b.reviseFromIndex);
  for (let i = 1; i < loops.length; i += 1) {
    const prev = loops[i - 1];
    const curr = loops[i];
    if (curr.reviseFromIndex <= prev.reviewIndex) {
      const msg = `Review loops "${prev.config.name ?? ""}" and "${curr.config.name ?? ""}" overlap; each step may belong to at most one loop.`;
      curr.summary.error = msg;
      return { loops, error: msg };
    }
  }

  return { loops, error: undefined };
}

function makeActiveLoop(
  config: WorkflowReviewLoop,
  reviseFromIndex: number,
  reviewIndex: number,
  summary: WorkflowReviewLoopRunSummary
): ActiveReviewLoop {
  return {
    config,
    reviseFromIndex,
    reviewIndex,
    summary,
    iteration: 1,
    latestReviewFeedback: "",
    latestReviewedArtifact: "",
    loopEntryPrevious: undefined,
    entryCaptured: false
  };
}

function computeProgressTotal(stepCount: number, loops: ActiveReviewLoop[]): number {
  let total = stepCount;
  for (const loop of loops) {
    total += (loop.summary.maxIterations - 1) * (loop.reviewIndex - loop.reviseFromIndex + 1);
  }
  return total;
}

function normalizeApprovalPattern(pattern: string | undefined): string {
  const candidate = pattern?.trim() || defaultReviewApprovalPattern;
  try {
    // Validate once so the runner never fails late because a saved workflow has a bad regex.
    void new RegExp(candidate, "im");
    return candidate;
  } catch {
    return defaultReviewApprovalPattern;
  }
}

function clampMaxIterations(value: number): number {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 20) : 3;
}

function isReviewApproved(output: string, approvalPattern: string): boolean {
  return new RegExp(approvalPattern, "im").test(output);
}

function buildRevisionContext(input: {
  task: string;
  iteration: number;
  stableContext: string;
  reviewedArtifact: string;
  reviewFeedback: string;
}): string {
  return [
    "Review loop revision context",
    `Iteration: ${input.iteration}`,
    "",
    "Original task:",
    input.task,
    "",
    "Stable upstream context before the revision loop:",
    input.stableContext || "(none)",
    "",
    "Latest artifact sent to peer review:",
    input.reviewedArtifact || "(empty)",
    "",
    "Peer review feedback to address:",
    input.reviewFeedback || "(empty)",
    "",
    "Instruction:",
    "Revise the work according to the peer review, preserve useful prior material, and pass an improved version to the next workflow step."
  ].join("\n");
}

async function safeReadSkillInstructions(directory: string): Promise<string | undefined> {
  try {
    return await readSkillInstructions(directory);
  } catch {
    return undefined;
  }
}

function pathBasename(directory: string): string {
  const segments = directory.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? directory;
}

/** Renders a human-readable markdown report of a workflow run. */
export function renderWorkflowReport(result: WorkflowRunResult): string {
  const lines: string[] = [];
  lines.push(`# Workflow: ${result.workflow.name}`);
  if (result.workflow.description) {
    lines.push("");
    lines.push(`> ${result.workflow.description}`);
  }
  lines.push("");
  lines.push("**Task:**");
  lines.push("");
  lines.push(quote(result.task));
  lines.push("");
  lines.push(`**Status:** ${renderRunStatus(result)} — ${result.steps.length} step(s)`);
  const loopSummaries = result.reviewLoops ?? [];
  if (loopSummaries.length > 0) {
    lines.push("");
    lines.push(`**Review loops (${loopSummaries.length}):**`);
    for (const loop of loopSummaries) {
      lines.push("");
      const label = loop.reviseFromStepName && loop.reviewStepName
        ? `${loop.reviseFromStepName} ↔ ${loop.reviewStepName}`
        : "(unknown loop)";
      lines.push(`- **${label}**`);
      if (loop.error) {
        lines.push(`  - Error: ${loop.error}`);
        continue;
      }
      lines.push(`  - Iterations: ${loop.iterations}/${loop.maxIterations}`);
      lines.push(`  - Approved: ${loop.approved ? "yes" : "no"}${loop.exhausted ? " (limit reached)" : ""}`);
    }
  }
  lines.push("");

  result.steps.forEach((stepResult, index) => {
    const step = stepResult.step;
    lines.push(`## Step ${index + 1}: ${step.name}`);
    lines.push("");
    lines.push(`- **Provider:** ${stepResult.providerName}`);
    lines.push(`- **Model:** ${stepResult.modelName}`);
    if (stepResult.loopIteration) {
      lines.push(`- **Review iteration:** ${stepResult.loopIteration}`);
    }
    if (stepResult.skillName) {
      lines.push(`- **Skill:** ${stepResult.skillName}`);
    }
    lines.push("");
    lines.push("**Prompt sent:**");
    lines.push("");
    lines.push(quote(stepResult.input));
    lines.push("");
    if (stepResult.error) {
      lines.push("**Error:**");
      lines.push("");
      lines.push(quote(stepResult.error));
      lines.push("");
    } else {
      lines.push("**Output:**");
      lines.push("");
      lines.push(stepResult.output.trim() || "_(empty)_");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  });

  if (result.succeeded && result.steps.length > 0) {
    lines.push("## Final Output");
    lines.push("");
    lines.push(result.finalOutput.trim() || "_(empty)_");
    lines.push("");
  }

  return lines.join("\n");
}

function renderRunStatus(result: WorkflowRunResult): string {
  if (!result.succeeded) {
    return "❌ Failed";
  }
  const loops = result.reviewLoops ?? [];
  if (loops.some((loop) => loop.error)) {
    return "❌ Failed — review loop misconfigured";
  }
  if (loops.length > 0 && loops.every((loop) => loop.approved)) {
    return "✅ Completed — all reviews approved";
  }
  if (loops.some((loop) => loop.exhausted)) {
    return "⚠️ Completed — one or more review loops hit the limit";
  }
  return "✅ Completed";
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}
