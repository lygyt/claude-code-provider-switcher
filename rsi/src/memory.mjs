import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJsonLine,
  nowIso,
  readJsonLines,
  safeId,
  tokenize,
  truncate,
  writeText
} from "./util.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRunsDir = path.resolve(moduleDir, "..", "runs");

export class LessonStore {
  constructor(options = {}) {
    this.file = options.file ?? path.join(defaultRunsDir, "lessons.jsonl");
    this.seed = Array.isArray(options.seed) ? options.seed : [];
    this.lessons = [];
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return this.lessons;
    }
    const stored = await readJsonLines(this.file);
    const seen = new Set();
    this.lessons = [];
    for (const lesson of [...this.seed, ...stored]) {
      if (!lesson || typeof lesson.lesson !== "string" || !lesson.lesson.trim()) {
        continue;
      }
      const key = lesson.lesson.trim().toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      this.lessons.push({
        taskId: String(lesson.taskId ?? "seed"),
        tags: Array.isArray(lesson.tags) ? lesson.tags.map(String) : [],
        lesson: lesson.lesson.trim().slice(0, 1000),
        accepted: Boolean(lesson.accepted),
        scoreDelta: typeof lesson.scoreDelta === "number" ? lesson.scoreDelta : 0,
        at: lesson.at ?? nowIso()
      });
    }
    this.loaded = true;
    return this.lessons;
  }

  async add(entry) {
    if (!entry || typeof entry.lesson !== "string" || !entry.lesson.trim()) {
      return;
    }
    await this.load();
    const text = entry.lesson.trim().slice(0, 1000);
    const key = text.toLowerCase();
    const existing = this.lessons.find((lesson) => lesson.lesson.toLowerCase() === key);
    if (existing) {
      existing.accepted = existing.accepted || Boolean(entry.accepted);
      existing.scoreDelta = Math.max(existing.scoreDelta, Number(entry.scoreDelta ?? 0));
      existing.at = nowIso();
    } else {
      this.lessons.push({
        taskId: String(entry.taskId ?? "unknown"),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
        lesson: text,
        accepted: Boolean(entry.accepted),
        scoreDelta: Number(entry.scoreDelta ?? 0),
        at: nowIso()
      });
    }

    await this.rewrite();
  }

  async rewrite() {
    const content = this.lessons.map((lesson) => JSON.stringify(lesson)).join("\n");
    await writeText(this.file, content ? `${content}\n` : "");
  }

  async retrieve(task, limit = 6) {
    await this.load();
    const queryTokens = new Set(tokenize([task.id, task.title, task.category, ...(task.tags ?? [])].join(" ")));
    const scored = this.lessons.map((lesson) => {
      const lessonTokens = new Set(tokenize([lesson.lesson, ...(lesson.tags ?? [])].join(" ")));
      let overlap = 0;
      for (const token of queryTokens) {
        if (lessonTokens.has(token)) {
          overlap += 1;
        }
      }
      const score = overlap + (lesson.accepted ? 0.5 : 0) + Math.max(0, lesson.scoreDelta) * 0.2;
      return { ...lesson, relevance: score };
    });

    return scored
      .filter((lesson) => lesson.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance || right.at.localeCompare(left.at))
      .slice(0, limit);
  }
}

export class RunArchive {
  constructor(options = {}) {
    this.root = options.root ?? defaultRunsDir;
  }

  taskDir(taskId) {
    return path.join(this.root, safeId(taskId));
  }

  async record(taskId, record) {
    await appendJsonLine(path.join(this.taskDir(taskId), "iterations.jsonl"), {
      at: nowIso(),
      taskId,
      ...record
    });
  }

  async saveBest(taskId, files) {
    for (const [relative, content] of Object.entries(files)) {
      await writeText(path.join(this.taskDir(taskId), "best", ...relative.split("/")), content);
    }
  }

  async saveReport(taskId, content) {
    await writeText(path.join(this.taskDir(taskId), "report.md"), content);
  }
}

export function summarizeFailure(evaluation) {
  const parts = [];
  if (evaluation.error) {
    parts.push(`Evaluation error: ${evaluation.error}`);
  }
  if (evaluation.hiddenResult?.failures?.length) {
    parts.push(`Hidden failures: ${evaluation.hiddenResult.failures.join("; ")}`);
  }
  if (evaluation.publicResult?.failures?.length) {
    parts.push(`Public failures: ${evaluation.publicResult.failures.join("; ")}`);
  }
  if (evaluation.violations?.length) {
    parts.push(`Policy violations: ${evaluation.violations.join("; ")}`);
  }
  if (!parts.length) {
    parts.push(`No improvement: score ${evaluation.score.toFixed(4)}.`);
  }
  return truncate(parts.join(" | "), 1200);
}
