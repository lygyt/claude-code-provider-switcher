import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeWorkflows, WorkflowStore, createWorkflowStepId } from "../src/workflowStore";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("workflowStore", () => {
  it("creates, updates, duplicates, and deletes workflows persistently", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-workflows-"));
    const configFilePath = path.join(tempRoot, ".claude-code-provider-switcher", "workflows.json");
    const store = new WorkflowStore(configFilePath);

    expect(await store.getWorkflows()).toEqual([]);

    const stepId = createWorkflowStepId();
    const created = await store.createWorkflow("Research Pipeline", [
      {
        id: stepId,
        name: "Researcher",
        providerId: "preset-deepseek",
        model: "deepseek-v4-pro",
        prompt: "Research: {{task}}"
      }
    ], "Two-step research");

    expect(created.name).toBe("Research Pipeline");
    expect(created.steps).toHaveLength(1);
    expect(created.steps[0].prompt).toBe("Research: {{task}}");

    // Persisted to disk and reloads cleanly
    const reloaded = new WorkflowStore(configFilePath);
    expect((await reloaded.getWorkflows()).map((wf) => wf.name)).toEqual(["Research Pipeline"]);

    const updated = await store.updateWorkflow(created.id, {
      name: "Research Pipeline v2",
      steps: [
        ...created.steps,
        {
          id: createWorkflowStepId(),
          name: "Writer",
          providerId: "preset-deepseek",
          model: "deepseek-v4-flash",
          skillDirectory: "C:/skills/writer",
          prompt: "Write from: {{previous}}"
        }
      ],
      reviewLoops: [
        {
          enabled: true,
          name: "code-test",
          reviseFromStepId: stepId,
          reviewStepId: stepId,
          maxIterations: 3,
          approvalPattern: "Decision: APPROVED"
        }
      ]
    });
    expect(updated.name).toBe("Research Pipeline v2");
    expect(updated.steps).toHaveLength(2);
    expect(updated.steps[1].skillDirectory).toBe("C:/skills/writer");
    expect(updated.reviewLoops).toEqual([
      {
        enabled: true,
        name: "code-test",
        reviseFromStepId: stepId,
        reviewStepId: stepId,
        maxIterations: 3,
        approvalPattern: "Decision: APPROVED"
      }
    ]);

    const duplicated = await store.duplicateWorkflow(created.id);
    expect(duplicated.name).toBe("Research Pipeline v2 (copy)");
    expect(duplicated.steps).toHaveLength(2);
    expect(duplicated.reviewLoops?.[0]?.enabled).toBe(true);
    expect(duplicated.id).not.toBe(created.id);

    expect((await store.getWorkflows()).length).toBe(2);

    await store.deleteWorkflow(duplicated.id);
    expect((await store.getWorkflows()).map((wf) => wf.id)).toEqual([created.id]);
  });

  it("recovers from a missing or corrupt workflows file", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-workflows-corrupt-"));
    const configFilePath = path.join(tempRoot, ".claude-code-provider-switcher", "workflows.json");
    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, "{ this is not valid json", "utf8");

    const store = new WorkflowStore(configFilePath);
    expect(await store.getWorkflows()).toEqual([]);

    // After creating, the file is rewritten as valid JSON
    await store.createWorkflow("Recovered", [
      { id: createWorkflowStepId(), name: "Step 1", providerId: "p", model: "m", prompt: "go" }
    ]);
    const raw = await fs.readFile(configFilePath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect((await store.getWorkflows()).length).toBe(1);
  });

  it("normalizes malformed workflow entries defensively", () => {
    const normalized = normalizeWorkflows([
      { id: "wf-1", name: "Good", steps: [{ id: "s1", name: "S1", providerId: "p", model: "m", prompt: "x" }] },
      { id: "", name: "NoId" },
      { id: "x" },
      "not-an-object",
      { id: "wf-2", name: "Empty steps", steps: "not-an-array" },
      {
        id: "wf-3",
        name: "Loop",
        steps: [{ id: "s1", name: "S1", providerId: "p", model: "m", prompt: "x" }],
        reviewLoop: { enabled: true, reviseFromStepId: "s1", reviewStepId: "s1", maxIterations: 2 }
      }
    ]);

    expect(normalized.map((wf) => wf.id)).toEqual(["wf-1", "wf-2", "wf-3"]);
    expect(normalized[1].steps).toEqual([]);
    // Legacy singular reviewLoop is migrated into the reviewLoops array.
    expect(normalized[2].reviewLoops?.[0]).toMatchObject({ enabled: true, maxIterations: 2 });
  });
});
