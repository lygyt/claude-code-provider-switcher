import * as vscode from "vscode";
import { ClaudeSkill, Workflow, WorkflowStep } from "./types";
import { WorkflowStore } from "./workflowStore";

type WorkflowTreeNodeKind = "workflow" | "step" | "empty";

export interface WorkflowTreeTarget {
  workflowId: string;
  stepId?: string;
}

export class WorkflowTreeProvider implements vscode.TreeDataProvider<WorkflowTreeNode> {
  private readonly changed = new vscode.EventEmitter<WorkflowTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly store: WorkflowStore) {}

  public refresh(): void {
    this.changed.fire(undefined);
  }

  public getTreeItem(element: WorkflowTreeNode): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: WorkflowTreeNode): Promise<WorkflowTreeNode[]> {
    const workflows = await this.store.getWorkflows();

    if (!element) {
      if (workflows.length === 0) {
        return [WorkflowTreeNode.empty("No workflows", "Create one with the + button")];
      }
      return workflows.map((workflow) => WorkflowTreeNode.workflow(workflow));
    }

    if (element.kind === "workflow" && element.workflowId) {
      const workflow = workflows.find((candidate) => candidate.id === element.workflowId);
      if (!workflow || workflow.steps.length === 0) {
        return [WorkflowTreeNode.empty("No steps", "Edit this workflow to add steps")];
      }
      return workflow.steps.map((step, index) => WorkflowTreeNode.step(workflow, step, index));
    }

    return [];
  }
}

export class WorkflowTreeNode extends vscode.TreeItem {
  private constructor(
    label: string,
    public readonly kind: WorkflowTreeNodeKind,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly workflowId?: string,
    public readonly stepId?: string
  ) {
    super(label, collapsibleState);
  }

  public static empty(label: string, description: string): WorkflowTreeNode {
    const item = new WorkflowTreeNode(label, "empty");
    item.description = description;
    item.iconPath = new vscode.ThemeIcon("circle-slash");
    item.contextValue = "claudeWorkflowEmpty";
    return item;
  }

  public static workflow(workflow: Workflow): WorkflowTreeNode {
    const item = new WorkflowTreeNode(
      workflow.name,
      "workflow",
      vscode.TreeItemCollapsibleState.Collapsed,
      workflow.id
    );
    const loopCount = workflow.reviewLoops?.filter((loop) => loop.enabled).length ?? 0;
    item.description = loopCount > 0
      ? `${workflow.steps.length} step(s), ${loopCount} loop(s)`
      : `${workflow.steps.length} step(s)`;
    item.tooltip = workflow.description ?? "Claude Code workflow";
    item.iconPath = new vscode.ThemeIcon("workflow");
    item.contextValue = "claudeWorkflow";
    return item;
  }

  public static step(workflow: Workflow, step: WorkflowStep, index: number): WorkflowTreeNode {
    const item = new WorkflowTreeNode(
      `${index + 1}. ${step.name}`,
      "step",
      vscode.TreeItemCollapsibleState.None,
      workflow.id,
      step.id
    );
    item.description = `${step.model || "default model"}`;
    item.tooltip = [
      step.name,
      `Model: ${step.model || "(provider default)"}`,
      step.skillDirectory ? `Skill: ${step.skillDirectory}` : undefined,
      step.prompt
    ]
      .filter(Boolean)
      .join("\n");
    item.iconPath = new vscode.ThemeIcon("symbol-number");
    item.contextValue = "claudeWorkflowStep";
    return item;
  }
}

/** Build QuickPick items describing available skills for the workflow editor. */
export function skillQuickPickItems(skills: ClaudeSkill[]): Array<{ label: string; description?: string; detail: string; value?: string }> {
  const none = [{ label: "(no skill)", description: "Run this step without a skill", detail: "", value: undefined }];
  const items = skills.map((skill) => ({
    label: skill.name,
    description: skill.scope,
    detail: skill.directory,
    value: skill.directory
  }));
  return [...none, ...items];
}

export function createWorkflowTreeTarget(workflowId: string, stepId?: string): WorkflowTreeTarget {
  return { workflowId, stepId };
}
