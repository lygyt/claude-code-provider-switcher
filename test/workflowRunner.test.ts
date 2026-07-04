import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class EventEmitter<T> {
    public readonly event = vi.fn();
    public fire(_value: T): void {}
  },
  ThemeIcon: class ThemeIcon {
    public constructor(public readonly id: string) {}
  },
  TreeItem: class TreeItem {
    public constructor(public readonly label: string, public readonly collapsibleState?: number) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  workspace: { workspaceFolders: [] }
}));

import { renderStepPrompt, renderWorkflowReport, runWorkflow } from "../src/workflowRunner";
import { Workflow, WorkflowStep } from "../src/types";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function step(overrides: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: overrides.id ?? "s1",
    name: overrides.name ?? "Step",
    providerId: overrides.providerId ?? "preset-deepseek",
    model: overrides.model ?? "deepseek-v4-pro",
    prompt: overrides.prompt ?? "Do: {{task}}",
    ...overrides
  };
}

function workflow(steps: WorkflowStep[]): Workflow {
  return {
    id: "wf-1",
    name: "Test Workflow",
    steps,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("workflowRunner", () => {
  it("renders {{task}} and {{previous}} template tokens", () => {
    expect(renderStepPrompt("Task: {{task}} | Prev: {{previous}}", { task: "write", previous: "research" })).toBe(
      "Task: write | Prev: research"
    );
    expect(renderStepPrompt("Input: {{input}}", { task: "t", previous: "p" })).toBe("Input: p");
    expect(renderStepPrompt("Round {{iteration}}: {{review}} / {{artifact}}", {
      task: "t",
      previous: "p",
      iteration: 2,
      review: "revise",
      artifact: "draft"
    })).toBe("Round 2: revise / draft");
    expect(renderStepPrompt("No tokens", { task: "t", previous: "p" })).toBe("No tokens");
  });

  it("chains step outputs as {{previous}} across multiple models", async () => {
    const calls: Array<{ model: string; messages: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push({ model: body.model, messages: body.messages });
      const content = body.model === "deepseek-v4-pro" ? "RESEARCH NOTES" : "FINAL ARTICLE";
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
    });

    const wf = workflow([
      step({ id: "s1", name: "Researcher", model: "deepseek-v4-pro", prompt: "Research {{task}}" }),
      step({ id: "s2", name: "Writer", model: "deepseek-v4-flash", prompt: "Write based on: {{previous}}" })
    ]);

    const result = await runWorkflow(
      wf,
      "remote work",
      {
        resolveProvider: async () => ({
          id: "preset-deepseek",
          name: "DeepSeek",
          authType: "anthropic-auth-token",
          baseUrl: "https://api.deepseek.com/anthropic",
          chatBaseUrl: "https://api.deepseek.com",
          chatModel: "deepseek-v4-pro",
          createdAt: "",
          updatedAt: ""
        }),
        resolveToken: async () => "secret",
        fetchImpl: fetchImpl as never
      }
    );

    expect(result.succeeded).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].output).toBe("RESEARCH NOTES");
    expect(result.steps[1].output).toBe("FINAL ARTICLE");
    expect(result.finalOutput).toBe("FINAL ARTICLE");

    // Step 2 received step 1's output as {{previous}}
    expect(calls[1].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "Write based on: RESEARCH NOTES" })])
    );
    // Each step used its own model
    expect(calls.map((c) => c.model)).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"]);
  });

  it("reruns the configured revision range until the review approves", async () => {
    const calls: Array<{ content: string }> = [];
    let reviewCalls = 0;
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const userMessage = body.messages.find((message: { role: string }) => message.role === "user");
      const content = userMessage.content as string;
      calls.push({ content });

      let output = "UNKNOWN";
      if (content.startsWith("Research")) {
        output = "RESEARCH NOTES";
      } else if (content.startsWith("Write")) {
        output = content.includes("Peer review feedback to address") ? "DRAFT V2" : "DRAFT V1";
      } else if (content.startsWith("Review")) {
        reviewCalls += 1;
        output = reviewCalls === 1 ? "Decision: REVISE\nNeeds stronger caveats." : "Decision: APPROVED\nReady.";
      }

      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content: output } }] }) };
    });

    const wf = workflow([
      step({ id: "research", name: "Researcher", prompt: "Research {{task}}" }),
      step({ id: "writer", name: "Writer", prompt: "Write {{previous}}" }),
      step({ id: "review", name: "Peer Reviewer", prompt: "Review {{previous}}" })
    ]);
    wf.reviewLoops = [
      {
        enabled: true,
        name: "manuscript-review",
        reviseFromStepId: "writer",
        reviewStepId: "review",
        maxIterations: 2
      }
    ];

    const result = await runWorkflow(
      wf,
      "caffeine and code errors",
      {
        resolveProvider: async () => ({
          id: "preset-deepseek",
          name: "DeepSeek",
          authType: "anthropic-auth-token",
          baseUrl: "https://api.deepseek.com/anthropic",
          chatBaseUrl: "https://api.deepseek.com",
          chatModel: "deepseek-v4-pro",
          createdAt: "",
          updatedAt: ""
        }),
        resolveToken: async () => "secret",
        fetchImpl: fetchImpl as never
      }
    );

    expect(result.succeeded).toBe(true);
    expect(result.reviewLoops?.[0]).toMatchObject({ approved: true, exhausted: false, iterations: 2 });
    expect(result.steps.map((entry) => entry.step.id)).toEqual(["research", "writer", "review", "writer", "review"]);
    // Steps outside the loop have no loopIteration; in-loop steps reflect the iteration.
    expect(result.steps.map((entry) => entry.loopIteration)).toEqual([undefined, 1, 1, 2, 2]);
    expect(result.finalOutput).toBe("DRAFT V2");
    expect(calls[3].content).toContain("Latest artifact sent for review:");
    expect(calls[3].content).toContain("DRAFT V1");
    expect(calls[3].content).toContain("Needs stronger caveats.");
  });

  it("runs two non-overlapping loops (code-test then manuscript-review)", async () => {
    let testerCalls = 0;
    let reviewerCalls = 0;
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const content = body.messages[body.messages.length - 1].content;
      let output: string;
      if (content.startsWith("Research")) {
        output = "BRIEF";
      } else if (content.startsWith("Code")) {
        output = content.includes("Peer review feedback to address") ? "CODE V2" : "CODE V1";
      } else if (content.startsWith("Test")) {
        testerCalls += 1;
        output = testerCalls === 1 ? "Decision: REVISE\nbug X" : "Decision: APPROVED";
      } else if (content.startsWith("Write")) {
        output = content.includes("Peer review feedback to address") ? "DRAFT V2" : "DRAFT V1";
      } else {
        reviewerCalls += 1;
        output = reviewerCalls === 1 ? "Decision: REVISE\nweak" : "Decision: APPROVED";
      }
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content: output } }] }) };
    });

    const wf = workflow([
      step({ id: "research", name: "Researcher", prompt: "Research {{task}}" }),
      step({ id: "coder", name: "Coder", prompt: "Code {{previous}}" }),
      step({ id: "tester", name: "Tester", prompt: "Test {{previous}}" }),
      step({ id: "writer", name: "Writer", prompt: "Write {{previous}}" }),
      step({ id: "reviewer", name: "Reviewer", prompt: "Review {{previous}}" })
    ]);
    wf.reviewLoops = [
      { enabled: true, name: "code-test", reviseFromStepId: "coder", reviewStepId: "tester", maxIterations: 2 },
      { enabled: true, name: "manuscript", reviseFromStepId: "writer", reviewStepId: "reviewer", maxIterations: 2 }
    ];

    const result = await runWorkflow(wf, "task", {
      resolveProvider: async () => ({
        id: "preset-deepseek",
        name: "DeepSeek",
        authType: "anthropic-auth-token",
        baseUrl: "https://api.deepseek.com/anthropic",
        chatBaseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-v4-pro",
        createdAt: "",
        updatedAt: ""
      }),
      resolveToken: async () => "secret",
      fetchImpl: fetchImpl as never
    });

    expect(result.succeeded).toBe(true);
    expect(result.reviewLoops?.map((loop) => ({ name: loop.reviseFromStepName, approved: loop.approved, iterations: loop.iterations })))
      .toEqual([
        { name: "Coder", approved: true, iterations: 2 },
        { name: "Writer", approved: true, iterations: 2 }
      ]);
    expect(result.steps.map((entry) => entry.step.id)).toEqual([
      "research", "coder", "tester", "coder", "tester", "writer", "reviewer", "writer", "reviewer"
    ]);
    expect(result.steps.map((entry) => entry.loopIteration)).toEqual([
      undefined, 1, 1, 2, 2, 1, 1, 2, 2
    ]);
    // After the code-test loop approves, the writer receives the approved code (CODE V2), not the review text.
    expect(result.steps[5].input).toContain("CODE V2");
    // finalOutput is the approved manuscript artifact.
    expect(result.finalOutput).toBe("DRAFT V2");
  });

  it("continues the pipeline when a loop exhausts without approval", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const content = body.messages[body.messages.length - 1].content;
      let output: string;
      if (content.startsWith("Research")) output = "BRIEF";
      else if (content.startsWith("Code")) output = "CODE";
      else if (content.startsWith("Write")) output = "WRITE_OUTPUT";
      else output = "Decision: REVISE\nstill buggy"; // tester never approves
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content: output } }] }) };
    });

    const wf = workflow([
      step({ id: "research", name: "Researcher", prompt: "Research {{task}}" }),
      step({ id: "coder", name: "Coder", prompt: "Code {{previous}}" }),
      step({ id: "tester", name: "Tester", prompt: "Test {{previous}}" }),
      step({ id: "writer", name: "Writer", prompt: "Write {{previous}}" })
    ]);
    wf.reviewLoops = [
      { enabled: true, name: "code-test", reviseFromStepId: "coder", reviewStepId: "tester", maxIterations: 2 }
    ];

    const result = await runWorkflow(wf, "task", {
      resolveProvider: async () => ({
        id: "preset-deepseek",
        name: "DeepSeek",
        authType: "anthropic-auth-token",
        baseUrl: "https://api.deepseek.com/anthropic",
        chatBaseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-v4-pro",
        createdAt: "",
        updatedAt: ""
      }),
      resolveToken: async () => "secret",
      fetchImpl: fetchImpl as never
    });

    // Exhausted but autonomous: pipeline still finishes (writer runs on the best code).
    expect(result.succeeded).toBe(true);
    expect(result.reviewLoops?.[0]).toMatchObject({ approved: false, exhausted: true, iterations: 2 });
    expect(result.steps.map((entry) => entry.step.id)).toEqual(["research", "coder", "tester", "coder", "tester", "writer"]);
    // Writer receives the best code artifact (not the review text) after exhaustion.
    expect(result.steps[5].input).toContain("CODE");
    expect(result.finalOutput).toBe("WRITE_OUTPUT");
  });

  it("injects the skill SKILL.md as a system message when a skillDirectory is set", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-workflow-skill-"));
    const skillDir = path.join(tempRoot, "my-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# My Skill\nYou are a strict reviewer.", "utf8");

    let captured: { messages: unknown } | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      captured = { messages: JSON.parse(init.body).messages };
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }) };
    });

    const wf = workflow([
      step({ id: "s1", skillDirectory: skillDir, prompt: "Review: {{task}}" })
    ]);

    await runWorkflow(wf, "the code", {
      resolveProvider: async () => ({
        id: "preset-deepseek",
        name: "DeepSeek",
        authType: "anthropic-auth-token",
        baseUrl: "https://api.deepseek.com/anthropic",
        chatBaseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-v4-pro",
        createdAt: "",
        updatedAt: ""
      }),
      resolveToken: async () => "secret",
      fetchImpl: fetchImpl as never
    });

    expect(captured?.messages).toEqual([
      expect.objectContaining({ role: "system", content: expect.stringContaining("strict reviewer") }),
      expect.objectContaining({ role: "user", content: "Review: the code" })
    ]);
  });

  it("stops and reports failure when a step errors", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid api key"
    }));

    const wf = workflow([
      step({ id: "s1", name: "Failing", prompt: "go" }),
      step({ id: "s2", name: "Never runs", prompt: "{{previous}}" })
    ]);

    const result = await runWorkflow(wf, "task", {
      resolveProvider: async () => ({
        id: "preset-deepseek",
        name: "DeepSeek",
        authType: "anthropic-auth-token",
        baseUrl: "https://api.deepseek.com/anthropic",
        chatBaseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-v4-pro",
        createdAt: "",
        updatedAt: ""
      }),
      resolveToken: async () => "bad",
      fetchImpl: fetchImpl as never
    });

    expect(result.succeeded).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].error).toContain("401");
  });

  it("renders a readable markdown report", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ choices: [{ message: { content: "Hello world" } }] })
    }));

    const wf = workflow([step({ id: "s1", name: "Greeter", prompt: "Greet: {{task}}" })]);
    const result = await runWorkflow(wf, "user", {
      resolveProvider: async () => ({
        id: "preset-deepseek",
        name: "DeepSeek",
        authType: "anthropic-auth-token",
        baseUrl: "https://api.deepseek.com/anthropic",
        chatBaseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-v4-pro",
        createdAt: "",
        updatedAt: ""
      }),
      resolveToken: async () => "secret",
      fetchImpl: fetchImpl as never
    });

    const report = renderWorkflowReport(result);
    expect(report).toContain("# Workflow: Test Workflow");
    expect(report).toContain("✅ Completed");
    expect(report).toContain("## Step 1: Greeter");
    expect(report).toContain("Hello world");
    expect(report).toContain("## Final Output");
  });
});
