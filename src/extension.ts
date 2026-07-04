import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ClaudeConversationHistoryProvider } from "./conversationHistory";
import { ProviderStore } from "./providerStore";
import { ProviderStatusBar } from "./statusBar";
import { registerProviderCommands, resumeConversationWithCurrentProvider, selectProviderById } from "./providerCommands";
import { ProviderWebviewProvider } from "./providerView";
import {
  ClaudeSkillGroup,
  ClaudeSkillProvider,
  importSkillFromGithubUrl,
  loadClaudeSkills,
  openSkillConfigFile,
  reinstallSkillFromSource,
  SkillActionTarget,
  SkillGroupActionTarget,
  SkillStore
} from "./skillManager";
import { ClaudeSkill, Workflow, WorkflowRunResult } from "./types";
import { showSafeError } from "./vscodeUtils";
import { WorkflowStore } from "./workflowStore";
import { WorkflowTreeProvider, WorkflowTreeNode } from "./workflowView";
import { WorkflowEditor } from "./workflowEditor";
import { WorkflowRunPanel } from "./workflowRunPanel";
import { renderWorkflowReport, runWorkflow } from "./workflowRunner";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Log activation so users / the extension host log can confirm it ran.
  console.log("[claude-code-provider-switcher] activate start");

  try {
    const store = new ProviderStore({
      globalState: context.globalState,
      secrets: context.secrets
    });

    const statusBar = new ProviderStatusBar(store);
    const skillStore = new SkillStore(context.globalState);
    context.subscriptions.push(statusBar.disposable);

    const conversationHistoryProvider = new ClaudeConversationHistoryProvider();
    const skillProvider = new ClaudeSkillProvider(skillStore);
    const providerWebviewProvider = new ProviderWebviewProvider(store, statusBar);
    const providerConfigPath = store.getConfigFilePath();
    const providerConfigWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(providerConfigPath), path.basename(providerConfigPath))
    );
    const refreshProviderViewsFromConfig = (): void => {
      void statusBar
        .refresh()
        .then(() => providerWebviewProvider.refresh())
        .catch((error: unknown) => {
          console.warn("[claude-code-provider-switcher] provider config refresh failed", error);
        });
    };

    registerProviderCommands(context, store, statusBar, skillStore, () => providerWebviewProvider.refresh());
    context.subscriptions.push(
      providerConfigWatcher,
      providerConfigWatcher.onDidChange(refreshProviderViewsFromConfig),
      providerConfigWatcher.onDidCreate(refreshProviderViewsFromConfig),
      providerConfigWatcher.onDidDelete(refreshProviderViewsFromConfig),
      vscode.window.registerWebviewViewProvider("claudeCodeProviderSwitcher.providers", providerWebviewProvider),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.openSidebar", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.claudeCodeProviderSwitcher");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.refreshProviders", () => {
        providerWebviewProvider.refresh();
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.selectProviderFromView", async (providerId: string) => {
        try {
          await selectProviderById(store, statusBar, skillStore, providerId);
          providerWebviewProvider.refresh();
        } catch (error) {
          showSafeError(error, "Failed to select Claude Code provider.");
        }
      }),
      vscode.window.registerTreeDataProvider(
        "claudeCodeProviderSwitcher.conversationHistory",
        conversationHistoryProvider
      ),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.refreshConversations", () => {
        conversationHistoryProvider.refresh();
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.resumeConversation", async (sessionId: string) => {
        try {
          await resumeConversationWithCurrentProvider(store, skillStore, sessionId);
        } catch (error) {
          showSafeError(error, "Failed to resume Claude Code conversation.");
        }
      }),
      vscode.window.registerTreeDataProvider("claudeCodeProviderSwitcher.skills", skillProvider),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.refreshSkills", () => {
        skillProvider.refresh();
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.openSkillConfig", async () => {
        await runSkillCommand(skillProvider, async () => {
          await openSkillConfigFile();
        }, "Failed to open Claude Code skill config.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.selectNoSkill", async () => {
        await runSkillCommand(skillProvider, async () => {
          const active = await skillStore.getAutoUseSkill();
          await skillStore.clearAutoUseSkill();
          if (active) {
            await vscode.window.showInformationMessage(
              `Cleared active skill "${active.name}". New Claude Code sessions will no longer auto-apply a skill.`
            );
          } else {
            await vscode.window.showInformationMessage("No active skill is set.");
          }
        }, "Failed to clear active Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.selectSkill", async (skillId?: string) => {
        await runSkillCommand(skillProvider, async () => {
          if (skillId) {
            const skill = await resolveSkillFromCommandTarget(skillId);
            if (!skill) {
              await vscode.window.showWarningMessage("Selected skill no longer exists. Refresh the skill list.");
              return;
            }

            await toggleSkillActivation(skillStore, skill);
            return;
          }

          await pickSkillToToggle(skillStore);
        }, "Failed to select Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.useSkill", async (target: SkillActionTarget | string) => {
        await runSkillCommand(skillProvider, async () => {
          const skill = await resolveSkillFromCommandTarget(target);
          if (!skill) {
            await vscode.window.showWarningMessage("Selected skill no longer exists. Refresh the skill list.");
            return;
          }

          await toggleSkillActivation(skillStore, skill);
        }, "Failed to toggle Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.installSkill", async (target: SkillActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const skill = await resolveSkillFromCommandTarget(target);
          if (!skill) {
            await vscode.window.showWarningMessage("Selected skill no longer exists. Refresh the skill list.");
            return;
          }

          await skillStore.installSkillDirectory(skill.directory);
          await vscode.window.showInformationMessage(`Claude Code skill installed: ${skill.name}`);
        }, "Failed to install Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.uninstallSkill", async (target: SkillActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const skill = await resolveSkillFromCommandTarget(target);
          const directory = skill?.directory ?? target?.skillDirectory;
          if (!directory) {
            await vscode.window.showWarningMessage("Selected skill no longer exists. Refresh the skill list.");
            return;
          }

          await skillStore.uninstallSkillDirectory(directory);
          await vscode.window.showInformationMessage(`Claude Code skill uninstalled: ${skill?.name ?? path.basename(directory)}`);
        }, "Failed to uninstall Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.reinstallSkill", async (target: SkillActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const skill = await resolveSkillFromCommandTarget(target);
          if (!skill) {
            await vscode.window.showWarningMessage("Selected skill no longer exists. Refresh the skill list.");
            return;
          }

          const confirmation = await vscode.window.showWarningMessage(
            `Reinstall "${skill.name}" from its GitHub source?`,
            { modal: true },
            "Reinstall"
          );
          if (confirmation !== "Reinstall") {
            return;
          }

          const refreshed = await reinstallSkillFromSource(skill);
          await skillStore.installSkillDirectory(refreshed.directory);
          await vscode.window.showInformationMessage(`Claude Code skill reinstalled: ${refreshed.name}`);
        }, "Failed to reinstall Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.clearInstalledSkills", async () => {
        await runSkillCommand(skillProvider, async () => {
          await skillStore.clearInstalledSkills();
          await vscode.window.showInformationMessage("All installed Claude Code skills cleared for new sessions.");
        }, "Failed to clear installed Claude Code skills.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.installSkillGroup", async (target: SkillGroupActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const group = await resolveSkillGroup(skillStore, target);
          if (!group) {
            await vscode.window.showWarningMessage("Selected skill group no longer exists.");
            return;
          }

          const skillsByDirectory = createSkillDirectoryMap(await loadClaudeSkills());
          const directories = group.skillDirectories.filter((directory) =>
            skillsByDirectory.has(normalizeDirectoryKey(directory))
          );
          await skillStore.setInstalledSkillDirectories([...(await skillStore.getInstalledSkillDirectories()), ...directories]);
          await vscode.window.showInformationMessage(`Installed ${directories.length} skill(s) from "${group.name}".`);
        }, "Failed to install Claude Code skill group.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.newSkillGroup", async () => {
        await runSkillCommand(skillProvider, async () => {
          const group = await promptCreateSkillGroup(skillStore);
          if (group) {
            await vscode.window.showInformationMessage(`Skill group created: ${group.name}`);
          }
        }, "Failed to create Claude Code skill group.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.renameSkillGroup", async (target: SkillGroupActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const group = await resolveSkillGroup(skillStore, target);
          if (!group) {
            await vscode.window.showWarningMessage("Selected skill group no longer exists.");
            return;
          }

          const name = await vscode.window.showInputBox({
            title: "Rename Skill Group",
            value: group.name,
            ignoreFocusOut: true,
            validateInput: (value) => (value.trim() ? undefined : "Group name is required.")
          });
          if (name === undefined) {
            return;
          }

          await skillStore.renameSkillGroup(group.id, name);
          await vscode.window.showInformationMessage(`Skill group renamed: ${name.trim()}`);
        }, "Failed to rename Claude Code skill group.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.deleteSkillGroup", async (target: SkillGroupActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const group = await resolveSkillGroup(skillStore, target);
          if (!group) {
            await vscode.window.showWarningMessage("Selected skill group no longer exists.");
            return;
          }

          const confirmation = await vscode.window.showWarningMessage(
            `Delete skill group "${group.name}"? Skill files and installed skills will not be removed.`,
            { modal: true },
            "Delete Group"
          );
          if (confirmation !== "Delete Group") {
            return;
          }

          await skillStore.deleteSkillGroup(group.id);
          await vscode.window.showInformationMessage(`Skill group deleted: ${group.name}`);
        }, "Failed to delete Claude Code skill group.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.addSkillToGroup", async (target: SkillGroupActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          const group = await resolveSkillGroup(skillStore, target);
          if (!group) {
            await vscode.window.showWarningMessage("Selected skill group no longer exists.");
            return;
          }

          const skill = await pickSkillForGroup(group);
          if (!skill) {
            return;
          }

          await skillStore.addSkillToGroup(group.id, skill.directory);
          await vscode.window.showInformationMessage(`Added "${skill.name}" to "${group.name}".`);
        }, "Failed to add Claude Code skill to group.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.removeSkillFromGroup", async (target: SkillActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          if (!target?.groupId || !target.skillDirectory) {
            return;
          }

          await skillStore.removeSkillFromGroup(target.groupId, target.skillDirectory);
          await vscode.window.showInformationMessage("Skill removed from group.");
        }, "Failed to remove Claude Code skill from group.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.moveSkillToGroup", async (target: SkillActionTarget) => {
        await runSkillCommand(skillProvider, async () => {
          if (!target?.groupId || !target.skillDirectory) {
            return;
          }

          const destination = await pickSkillGroup(skillStore, "Move Skill To Group", target.groupId);
          if (!destination) {
            return;
          }

          await skillStore.moveSkillToGroup(target.groupId, destination.id, target.skillDirectory);
          await vscode.window.showInformationMessage(`Skill moved to "${destination.name}".`);
        }, "Failed to move Claude Code skill.");
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.importSkillFromGitHub", async () => {
        await runSkillCommand(skillProvider, async () => {
          const url = await vscode.window.showInputBox({
            title: "Import Skill from GitHub",
            placeHolder: "https://github.com/owner/skill-repo",
            ignoreFocusOut: true,
            validateInput: (value) => (value.trim() ? undefined : "GitHub URL is required.")
          });
          if (!url) {
            return;
          }

          const installChoice = await vscode.window.showQuickPick(
            [
              { label: "Install after import", install: true, description: "Load this skill in new Claude Code sessions" },
              { label: "Import only", install: false, description: "Download it without adding it to new sessions" }
            ],
            { title: "GitHub Skill Import", placeHolder: "Choose whether to install after import" }
          );
          if (!installChoice) {
            return;
          }

          const skill = await importSkillFromGithubUrl(url);
          if (installChoice.install) {
            await skillStore.installSkillDirectory(skill.directory);
          }

          const action = await vscode.window.showInformationMessage(
            `${installChoice.install ? "Imported and installed" : "Imported"} Claude Code skill: ${skill.name}`,
            "Add to Group",
            "Open Folder"
          );
          if (action === "Add to Group") {
            const group = await pickSkillGroup(skillStore, "Add Imported Skill To Group");
            if (group) {
              await skillStore.addSkillToGroup(group.id, skill.directory);
            }
          } else if (action === "Open Folder") {
            await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(skill.directory));
          }
        }, "Failed to import Claude Code skill from GitHub.");
      })
    );

    const workflowStore = new WorkflowStore();
    const workflowProvider = new WorkflowTreeProvider(workflowStore);
    const workflowEditor = new WorkflowEditor(workflowStore, store, skillStore);
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("claudeCodeProviderSwitcher.workflows", workflowProvider),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.refreshWorkflows", () => {
        workflowProvider.refresh();
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.newWorkflow", async () => {
        try {
          await workflowEditor.open();
          workflowProvider.refresh();
        } catch (error) {
          showSafeError(error, "Failed to open the workflow editor.");
        }
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.editWorkflow", async (target: WorkflowTreeNode | undefined) => {
        try {
          const workflow = await resolveWorkflowTarget(workflowStore, target);
          if (!workflow) {
            await vscode.window.showWarningMessage("Select a workflow to edit.");
            return;
          }
          await workflowEditor.open(workflow);
          workflowProvider.refresh();
        } catch (error) {
          showSafeError(error, "Failed to open the workflow editor.");
        }
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.deleteWorkflow", async (target: WorkflowTreeNode | undefined) => {
        try {
          const workflow = await resolveWorkflowTarget(workflowStore, target);
          if (!workflow) {
            await vscode.window.showWarningMessage("Select a workflow to delete.");
            return;
          }
          const confirmation = await vscode.window.showWarningMessage(
            `Delete workflow "${workflow.name}"?`,
            { modal: true },
            "Delete"
          );
          if (confirmation !== "Delete") {
            return;
          }
          await workflowStore.deleteWorkflow(workflow.id);
          await vscode.window.showInformationMessage(`Workflow deleted: ${workflow.name}`);
        } catch (error) {
          showSafeError(error, "Failed to delete workflow.");
        }
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.duplicateWorkflow", async (target: WorkflowTreeNode | undefined) => {
        try {
          const workflow = await resolveWorkflowTarget(workflowStore, target);
          if (!workflow) {
            return;
          }
          const duplicated = await workflowStore.duplicateWorkflow(workflow.id);
          await vscode.window.showInformationMessage(`Workflow duplicated: ${duplicated.name}`);
        } catch (error) {
          showSafeError(error, "Failed to duplicate workflow.");
        }
      }),
      vscode.commands.registerCommand("claudeCodeProviderSwitcher.runWorkflow", async (target: WorkflowTreeNode | undefined) => {
        await runWorkflowCommand(workflowStore, store, workflowProvider, target);
      })
    );

    try {
      await store.ensureBuiltInPresets();
      await statusBar.refresh();
      providerWebviewProvider.refresh();
    } catch (error) {
      showSafeError(error, "Failed to initialize Claude Code Provider Switcher.");
    }

    console.log("[claude-code-provider-switcher] activate complete");
  } catch (error) {
    console.error("[claude-code-provider-switcher] activate failed", error);
    showSafeError(error, "Claude Code Provider Switcher failed to start. Reload the window and try again.");
  }
}

export function deactivate(): void {
  // No background resources are created by this extension.
}

async function runSkillCommand(
  skillProvider: ClaudeSkillProvider,
  action: () => Promise<void>,
  errorMessage: string
): Promise<void> {
  try {
    await action();
    skillProvider.refresh();
  } catch (error) {
    showSafeError(error, errorMessage);
  }
}

async function resolveSkillFromCommandTarget(target: string | SkillActionTarget | undefined): Promise<ClaudeSkill | undefined> {
  const skills = await loadClaudeSkills();
  if (typeof target === "string") {
    return skills.find((skill) => skill.id === target);
  }

  const directory = target?.skillDirectory;
  if (!directory) {
    return undefined;
  }

  const key = normalizeDirectoryKey(directory);
  return skills.find((skill) => normalizeDirectoryKey(skill.directory) === key);
}

async function resolveSkillGroup(
  skillStore: SkillStore,
  target: SkillGroupActionTarget | undefined
): Promise<ClaudeSkillGroup | undefined> {
  const groupId = target?.groupId;
  if (!groupId) {
    return undefined;
  }

  return (await skillStore.getSkillGroups()).find((group) => group.id === groupId);
}

/**
 * Toggles the auto-use (active) state of a skill. Activating installs the skill
 * (so the star is meaningful) and marks it for automatic use in new sessions,
 * but does NOT spawn a terminal — launching stays an explicit action. The
 * information message offers a "Launch Now" button so the convenience is not
 * lost. Deactivating only clears the auto-use marker; background-installed
 * skills keep loading as slash commands.
 */
async function toggleSkillActivation(skillStore: SkillStore, skill: ClaudeSkill): Promise<void> {
  const active = await skillStore.getAutoUseSkill();
  const isActive = active !== undefined && normalizeDirectoryKey(active.directory) === normalizeDirectoryKey(skill.directory);
  if (isActive) {
    await skillStore.clearAutoUseSkill();
    await vscode.window.showInformationMessage(
      `Cleared active skill "${skill.name}". New Claude Code sessions will no longer auto-apply it.`
    );
    return;
  }

  await skillStore.useSkillDirectory(skill.directory);
  const action = await vscode.window.showInformationMessage(
    `Active skill set to "${skill.name}". It will be applied automatically in new Claude Code sessions.`,
    "Launch Now"
  );
  if (action === "Launch Now") {
    await vscode.commands.executeCommand("claudeCodeProviderSwitcher.launchCurrentProvider");
  }
}

async function pickSkillToToggle(skillStore: SkillStore): Promise<void> {
  const skills = await loadClaudeSkills();
  if (skills.length === 0) {
    await vscode.window.showInformationMessage(
      "No skills are available. Import one from GitHub or add a skill root via the skill config."
    );
    return;
  }

  const active = await skillStore.getAutoUseSkill();
  const activeKey = active ? normalizeDirectoryKey(active.directory) : undefined;
  const selected = await vscode.window.showQuickPick(
    skills.map((skill) => ({
      label: activeKey && normalizeDirectoryKey(skill.directory) === activeKey ? `$(star-full) ${skill.name}` : skill.name,
      description: skill.scope,
      detail: skill.directory,
      skill
    })),
    {
      title: active ? `Active skill: ${active.name}` : "No active skill",
      placeHolder: "Select a skill to activate or deactivate"
    }
  );

  if (!selected) {
    return;
  }

  await toggleSkillActivation(skillStore, selected.skill);
}

async function promptCreateSkillGroup(skillStore: SkillStore): Promise<ClaudeSkillGroup | undefined> {
  const name = await vscode.window.showInputBox({
    title: "New Skill Group",
    placeHolder: "e.g. Review, Docs, Frontend",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "Group name is required.")
  });
  if (name === undefined) {
    return undefined;
  }

  return skillStore.createSkillGroup(name);
}

async function pickSkillGroup(
  skillStore: SkillStore,
  title: string,
  excludedGroupId?: string
): Promise<ClaudeSkillGroup | undefined> {
  const groups = (await skillStore.getSkillGroups()).filter((group) => group.id !== excludedGroupId);
  if (groups.length === 0) {
    const choice = await vscode.window.showInformationMessage("No skill groups are available.", "New Group");
    if (choice !== "New Group") {
      return undefined;
    }

    return promptCreateSkillGroup(skillStore);
  }

  const selected = await vscode.window.showQuickPick(
    groups.map((group) => ({
      label: group.name,
      description: `${group.skillDirectories.length} skill(s)`,
      group
    })),
    { title, placeHolder: "Choose a skill group" }
  );

  return selected?.group;
}

async function pickSkillForGroup(group: ClaudeSkillGroup): Promise<ClaudeSkill | undefined> {
  const groupDirectories = new Set(group.skillDirectories.map(normalizeDirectoryKey));
  const skills = (await loadClaudeSkills()).filter((skill) => !groupDirectories.has(normalizeDirectoryKey(skill.directory)));
  if (skills.length === 0) {
    await vscode.window.showInformationMessage("No more skills are available to add to this group.");
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    skills.map((skill) => ({
      label: skill.name,
      description: skill.scope,
      detail: skill.directory,
      skill
    })),
    { title: `Add Skill To ${group.name}`, placeHolder: "Choose a skill" }
  );

  return selected?.skill;
}

function createSkillDirectoryMap(skills: ClaudeSkill[]): Map<string, ClaudeSkill> {
  return new Map(skills.map((skill) => [normalizeDirectoryKey(skill.directory), skill]));
}

function normalizeDirectoryKey(directory: string): string {
  return path.normalize(directory).toLowerCase();
}

async function resolveWorkflowTarget(
  workflowStore: WorkflowStore,
  target: WorkflowTreeNode | { workflowId?: string } | undefined
): Promise<Workflow | undefined> {
  const workflowId = (target as { workflowId?: string } | undefined)?.workflowId;
  if (workflowId) {
    return workflowStore.getWorkflow(workflowId);
  }

  const workflows = await workflowStore.getWorkflows();
  if (workflows.length === 0) {
    await vscode.window.showInformationMessage("No workflows exist yet. Create one first.");
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    workflows.map((workflow) => ({
      label: workflow.name,
      description: `${workflow.steps.length} step(s)`,
      detail: workflow.description,
      workflow
    })),
    { title: "Choose a workflow", placeHolder: "Select a workflow" }
  );

  return selected?.workflow;
}

async function runWorkflowCommand(
  workflowStore: WorkflowStore,
  providerStore: ProviderStore,
  workflowProvider: WorkflowTreeProvider,
  target: WorkflowTreeNode | undefined
): Promise<void> {
  try {
    const workflow = await resolveWorkflowTarget(workflowStore, target);
    if (!workflow) {
      return;
    }
    if (workflow.steps.length === 0) {
      await vscode.window.showWarningMessage(`Workflow "${workflow.name}" has no steps. Edit it first.`);
      return;
    }

    const task = await vscode.window.showInputBox({
      title: `Run Workflow: ${workflow.name}`,
      prompt: "Describe the task this workflow should complete",
      placeHolder: "e.g. Write a short blog intro about remote work",
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : "Task is required.")
    });
    if (task === undefined) {
      return;
    }

    // Folder picker for project output
    const folderUris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: "Choose output folder for the workflow project"
    });
    if (!folderUris || folderUris.length === 0) {
      return;
    }
    const baseDir = folderUris[0].fsPath;

    // Create project directory: <baseDir>/<sanitized-workflow-name>-<timestamp>/
    const safeName = workflow.name.replace(/[<>:"/\\|?*\s]+/g, "-").replace(/-+/g, "-");
    const timestamp = new Date().toISOString().replace(/[:.]+/g, "-").slice(0, 17);
    const projectDir = path.join(baseDir, `${safeName}-${timestamp}`);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, "code"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "data"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "figures"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "paper"), { recursive: true });

    const activeProvider = await providerStore.getActiveProvider();
    const panel = new WorkflowRunPanel(workflow, task, activeProvider?.name ?? "default");

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running workflow: ${workflow.name}`,
        cancellable: false
      },
      async (progress): Promise<WorkflowRunResult> => {
        return runWorkflow(
          workflow,
          task,
          {
            resolveProvider: async (providerId: string) =>
              (await providerStore.getProviders()).find((candidate) => candidate.id === providerId),
            resolveToken: (providerId: string) => providerStore.getToken(providerId),
            projectDir,
            onFileWritten: (_relativePath: string) => {
              // Panel could show file writes here; for now, a no-op.
            }
          },
          {
            report: (step, stepIndex, totalSteps) => {
              progress.report({
                message: `Step ${stepIndex + 1}/${totalSteps}: ${step.name}`,
                increment: (1 / totalSteps) * 100
              });
            },
            onStepCompleted: (stepResult, stepIndex, totalSteps) => {
              panel.onStepCompleted(stepResult, stepIndex, totalSteps);
            }
          }
        );
      }
    );

    panel.onFinished(result);

    // Save markdown report to project directory
    try {
      const report = renderWorkflowReport(result);
      const readmePath = path.join(projectDir, "README.md");
      await fs.writeFile(readmePath, report, "utf8");
      // Open the project directory and key files
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(projectDir));
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(readmePath));
      await vscode.window.showTextDocument(doc, { preview: false });
      const texPath = path.join(projectDir, "paper", "main.tex");
      try {
        await fs.access(texPath);
        const texDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(texPath));
        await vscode.window.showTextDocument(texDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      } catch {
        // paper/main.tex doesn't exist (no template step) — that's fine
      }
    } catch {
      // Best-effort: report saved to runs/ dir by panel's auto-save anyway.
    }

    if (result.succeeded) {
      await vscode.window.showInformationMessage(`Workflow completed: ${workflow.name}`);
    } else {
      await vscode.window.showErrorMessage(`Workflow failed: ${workflow.name}. See the report for details.`);
    }
    workflowProvider.refresh();
  } catch (error) {
    showSafeError(error, "Failed to run workflow.");
  }
}
