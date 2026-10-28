import { evaluateTask, summarizeEvaluation } from "./evaluator.mjs";
import { summarizeFailure } from "./memory.mjs";
import { buildProposalPrompt, loadPromptTemplate } from "./prompts.mjs";
import { readCurrentEditable, validateProposal } from "./workspace.mjs";
import { walkFiles } from "./util.mjs";

function round(value) {
  return Number(value.toFixed(4));
}

function renderReport(task, result) {
  const lines = [
    `# RSI report: ${task.title}`,
    "",
    `- Task: \`${task.id}\``,
    `- Category: ${task.category}`,
    `- Baseline score: ${round(result.baseline.score)}`,
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
    lines.push(
      `| ${entry.iteration} | ${evaluation ? round(evaluation.score) : "n/a"} | ${hidden} | ${publicResult} | ${bench} | ${
        entry.accepted ? "yes" : "no"
      } | ${rationale} |`
    );
  }

  lines.push("", "## Best metrics", "", "```json", JSON.stringify(summarizeEvaluation(result.best), null, 2), "```", "");
  lines.push("## Best files", "", ...Object.keys(result.bestFiles).map((file) => `- \`${file}\``), "");
  return lines.join("\n");
}

export async function runTask(task, options = {}) {
  const proposer = options.proposer;
  if (!proposer) {
    throw new Error("runTask requires a proposer.");
  }

  const maxIterations = Number(options.maxIterations ?? 3);
  const minDelta = Number(options.minDelta ?? 0.01);
  const targetScore = Number(options.targetScore ?? 0.98);
  const template = options.promptTemplate ?? (await loadPromptTemplate("proposer.v1.md"));
  const archive = options.archive;
  const lessonStore = options.lessonStore;
  const onProgress = options.onProgress;

  const baselineFiles = await readCurrentEditable(task);
  const baseline = await evaluateTask(task, {
    files: baselineFiles,
    measureBenchmark: options.measureBaselineBenchmark !== false
  });
  let best = baseline;
  let bestFiles = baselineFiles;
  const history = [];
  let previousFailures = [];
  const workspaceTree = await walkFiles(task.workspaceDir);

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (best.score >= targetScore) {
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

    const candidate = await evaluateTask(task, { files: normalizedFiles });
    const previousBestScore = best.score;
    const accepted =
      candidate.score > best.score + minDelta &&
      candidate.hiddenPassRate >= best.hiddenPassRate - 1e-9;

    const entry = {
      iteration,
      accepted,
      rationale: proposal.rationale,
      evaluation: candidate,
      lessons: proposal.lessons
    };
    history.push(entry);

    if (accepted) {
      best = candidate;
      bestFiles = normalizedFiles;
      previousFailures = [];
    } else {
      previousFailures = [...previousFailures, summarizeFailure(candidate)].slice(-5);
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
        score: candidate.score,
        previousBest: previousBestScore,
        summary: summarizeEvaluation(candidate),
        rationale: proposal.rationale,
        lessons: proposal.lessons,
        files: Object.keys(normalizedFiles)
      });
    }

    if (onProgress) {
      onProgress({ iteration, best, accepted, evaluation: candidate });
    }
  }

  const result = {
    task,
    baseline,
    best,
    bestFiles,
    history,
    report: renderReport(task, { baseline, best, bestFiles, history })
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
      improved: results.filter((result) => result.best.score > result.baseline.score + 0.01).length
    }
  };
}
