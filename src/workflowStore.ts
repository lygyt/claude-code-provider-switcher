import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Workflow, WorkflowReviewLoop, WorkflowStep } from "./types";
import { nowIso } from "./utils";

const workflowConfigRelativePath = path.join(".claude-code-provider-switcher", "workflows.json");

interface WorkflowConfigFile {
  version?: unknown;
  workflows?: unknown;
}

export function getWorkflowConfigPath(
  workspaceRoots: string[] = []
): string {
  return workspaceRoots[0]
    ? path.join(workspaceRoots[0], workflowConfigRelativePath)
    : path.join(os.homedir(), workflowConfigRelativePath);
}

export class WorkflowStore {
  public constructor(private readonly configFilePath = getWorkflowConfigPath()) {}

  public async getWorkflows(): Promise<Workflow[]> {
    return (await this.readConfig()).workflows;
  }

  public async getWorkflow(id: string): Promise<Workflow | undefined> {
    return (await this.getWorkflows()).find((workflow) => workflow.id === id);
  }

  public async createWorkflow(
    name: string,
    steps: WorkflowStep[] = [],
    description?: string,
    reviewLoops?: WorkflowReviewLoop[]
  ): Promise<Workflow> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Workflow name is required.");
    }

    const now = nowIso();
    const workflow: Workflow = {
      id: randomUUID(),
      name: trimmedName,
      description: description?.trim() || undefined,
      steps: cloneSteps(steps),
      reviewLoops: cloneReviewLoops(reviewLoops),
      createdAt: now,
      updatedAt: now
    };

    await this.writeConfig((config) => ({ ...config, workflows: [...config.workflows, workflow] }));
    return workflow;
  }

  public async updateWorkflow(
    id: string,
    patch: Partial<Pick<Workflow, "name" | "description" | "steps" | "reviewLoops">>
  ): Promise<Workflow> {
    let updated: Workflow | undefined;
    await this.writeConfig((config) => {
      const workflows = config.workflows.map((workflow) => {
        if (workflow.id !== id) {
          return workflow;
        }

        updated = {
          ...workflow,
          name: patch.name?.trim() || workflow.name,
          description: patch.description !== undefined ? (patch.description.trim() || undefined) : workflow.description,
          steps: patch.steps ? cloneSteps(patch.steps) : workflow.steps,
          reviewLoops: patch.reviewLoops !== undefined ? cloneReviewLoops(patch.reviewLoops) : workflow.reviewLoops,
          updatedAt: nowIso()
        };
        return updated;
      });

      return { ...config, workflows };
    });

    if (!updated) {
      throw new Error(`Workflow "${id}" was not found.`);
    }

    return updated;
  }

  public async deleteWorkflow(id: string): Promise<void> {
    await this.writeConfig((config) => ({
      ...config,
      workflows: config.workflows.filter((workflow) => workflow.id !== id)
    }));
  }

  public async duplicateWorkflow(id: string, newName?: string): Promise<Workflow> {
    const source = await this.getWorkflow(id);
    if (!source) {
      throw new Error(`Workflow "${id}" was not found.`);
    }

    return this.createWorkflow(newName?.trim() || `${source.name} (copy)`, source.steps, source.description, source.reviewLoops);
  }

  private async readConfig(): Promise<{ workflows: Workflow[] }> {
    let content: string;
    try {
      content = await fs.readFile(this.configFilePath, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return { workflows: [] };
      }
      throw error;
    }

    const stripped = content.trim();
    if (!stripped) {
      return { workflows: [] };
    }

    let parsed: WorkflowConfigFile;
    try {
      parsed = JSON.parse(stripped) as WorkflowConfigFile;
    } catch {
      return { workflows: [] };
    }

    return { workflows: normalizeWorkflows(parsed.workflows) };
  }

  private async writeConfig(update: (config: { workflows: Workflow[] }) => { workflows: Workflow[] }): Promise<void> {
    const current = await this.readConfig();
    const next = update(current);
    await fs.mkdir(path.dirname(this.configFilePath), { recursive: true });
    await fs.writeFile(
      this.configFilePath,
      `${JSON.stringify({ version: 1, workflows: next.workflows }, null, 2)}\n`,
      "utf8"
    );
  }
}

export function createWorkflowStepId(): string {
  return randomUUID();
}

export function normalizeWorkflows(value: unknown): Workflow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): Workflow | undefined => {
      const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : undefined;
      if (!record) {
        return undefined;
      }

      const id = readString(record.id);
      const name = readString(record.name);
      if (!id || !name) {
        return undefined;
      }

      return {
        id,
        name,
        description: readString(record.description),
        steps: normalizeSteps(record.steps),
        reviewLoops: normalizeReviewLoops(record.reviewLoops, record.reviewLoop),
        createdAt: readString(record.createdAt) ?? nowIso(),
        updatedAt: readString(record.updatedAt) ?? nowIso()
      };
    })
    .filter((workflow): workflow is Workflow => workflow !== undefined);
}

function normalizeSteps(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): WorkflowStep | undefined => {
      const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : undefined;
      if (!record) {
        return undefined;
      }

      const id = readString(record.id) ?? createWorkflowStepId();
      const name = readString(record.name) ?? "Untitled step";
      const providerId = readString(record.providerId) ?? "";
      const model = readString(record.model) ?? "";
      const prompt = readString(record.prompt) ?? "";

      return {
        id,
        name,
        providerId,
        model,
        skillDirectory: readString(record.skillDirectory),
        prompt,
        execute: record.execute === true,
        templatePath: readString(record.templatePath)
      };
    })
    .filter((step): step is WorkflowStep => step !== undefined);
}

function cloneSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => ({ ...step }));
}

function cloneReviewLoops(reviewLoops: WorkflowReviewLoop[] | undefined): WorkflowReviewLoop[] | undefined {
  if (!reviewLoops || reviewLoops.length === 0) {
    return undefined;
  }

  return reviewLoops.map((loop) => ({
    ...loop,
    name: loop.name?.trim() || undefined,
    approvalPattern: loop.approvalPattern?.trim() || undefined
  }));
}

function normalizeReviewLoops(arrayValue: unknown, legacySingleValue?: unknown): WorkflowReviewLoop[] | undefined {
  const loops: WorkflowReviewLoop[] = [];
  if (Array.isArray(arrayValue)) {
    for (const entry of arrayValue) {
      const loop = normalizeReviewLoop(entry);
      if (loop) {
        loops.push(loop);
      }
    }
  }

  // Backward compatibility: a legacy singular reviewLoop is wrapped into the array.
  if (loops.length === 0 && legacySingleValue !== undefined) {
    const legacy = normalizeReviewLoop(legacySingleValue);
    if (legacy) {
      loops.push(legacy);
    }
  }

  return loops.length > 0 ? loops : undefined;
}

function normalizeReviewLoop(value: unknown): WorkflowReviewLoop | undefined {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  if (!record) {
    return undefined;
  }

  const reviseFromStepId = readString(record.reviseFromStepId);
  const reviewStepId = readString(record.reviewStepId);
  if (!reviseFromStepId || !reviewStepId) {
    return undefined;
  }

  const maxIterations = readPositiveInteger(record.maxIterations, 3);
  return {
    enabled: record.enabled === true,
    name: readString(record.name),
    reviseFromStepId,
    reviewStepId,
    maxIterations,
    approvalPattern: readString(record.approvalPattern)
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
