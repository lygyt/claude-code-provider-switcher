import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ProviderStatusBar } from "./statusBar";
import { ProviderStore } from "./providerStore";
import { pickProvider, pickProviderOrAction, ProviderPickerAction } from "./providerPicker";
import { SkillStore } from "./skillManager";
import { ClaudeEffortLevel, ProviderAuthType, ProviderProfile, ProviderProfileDraft, SecretChange } from "./types";
import { authTypeRequiresToken, validateBaseUrl, validateProviderName, validateTokenRequirement } from "./validation";
import {
  checkClaudeCliAvailable,
  cleanupStaleGeneratedFiles,
  createVsCodeTerminalDependencies,
  launchClaudeCode,
  SkillLaunchSelection
} from "./terminalLauncher";
import { getConfig, showSafeError } from "./vscodeUtils";

const authTypes: Array<{ label: string; authType: ProviderAuthType; description: string }> = [
  {
    label: "Anthropic Auth Token",
    authType: "anthropic-auth-token",
    description: "Injects ANTHROPIC_AUTH_TOKEN"
  },
  {
    label: "Anthropic API Key",
    authType: "anthropic-api-key",
    description: "Injects ANTHROPIC_API_KEY"
  },
  {
    label: "OAuth",
    authType: "oauth",
    description: "Uses Claude Code's existing official login state"
  }
];

const effortLevels: Array<{ label: string; effortLevel?: ClaudeEffortLevel; description: string }> = [
  { label: "None", description: "Do not set CLAUDE_CODE_EFFORT_LEVEL" },
  { label: "low", effortLevel: "low", description: "Low effort" },
  { label: "medium", effortLevel: "medium", description: "Medium effort" },
  { label: "high", effortLevel: "high", description: "High effort" },
  { label: "max", effortLevel: "max", description: "Maximum effort" }
];

export function registerProviderCommands(
  context: vscode.ExtensionContext,
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  skillStore: SkillStore,
  onProvidersChanged?: () => void
): void {
  const commands: Array<[string, () => Promise<void>]> = [
    ["claudeCodeProviderSwitcher.selectProvider", () => selectProvider(store, statusBar, skillStore, onProvidersChanged)],
    ["claudeCodeProviderSwitcher.addProvider", () => addProvider(store, statusBar, onProvidersChanged)],
    ["claudeCodeProviderSwitcher.editProvider", () => editProvider(store, statusBar, onProvidersChanged)],
    ["claudeCodeProviderSwitcher.deleteProvider", () => deleteProvider(store, statusBar, onProvidersChanged)],
    ["claudeCodeProviderSwitcher.launchCurrentProvider", () => launchCurrentProvider(store, skillStore)],
    ["claudeCodeProviderSwitcher.resetPresets", () => resetPresets(store, statusBar, onProvidersChanged)],
    ["claudeCodeProviderSwitcher.openProviderConfig", () => openProviderConfig(store)]
  ];

  for (const [id, command] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await command();
        } catch (error) {
          showSafeError(error, "Claude Code Provider Switcher command failed.");
        }
      })
    );
  }
}

export async function selectProviderById(
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  skillStore: SkillStore,
  providerId: string
): Promise<void> {
  const provider = (await store.getProviders()).find((candidate) => candidate.id === providerId);
  if (!provider) {
    await vscode.window.showWarningMessage("Selected provider no longer exists. Refresh the provider list.");
    return;
  }

  await store.setActiveProviderId(provider.id);
  await statusBar.refresh();

  if (getConfig().launchAfterSelection) {
    await launchProvider(store, skillStore, provider);
  }
}

async function selectProvider(
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  skillStore: SkillStore,
  onProvidersChanged?: () => void
): Promise<void> {
  await store.ensureBuiltInPresets();
  const result = await pickProviderOrAction(await store.getProviders(), await store.getActiveProviderId());
  if (!result) {
    return;
  }

  if (result.kind === "action") {
    await runPickerAction(result.action, store, statusBar, skillStore);
    return;
  }

  await store.setActiveProviderId(result.provider.id);
  await statusBar.refresh();
  onProvidersChanged?.();

  if (getConfig().launchAfterSelection) {
    await launchProvider(store, skillStore, result.provider);
  }
}

async function runPickerAction(
  action: ProviderPickerAction,
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  skillStore: SkillStore
): Promise<void> {
  if (action === "add") {
    await addProvider(store, statusBar);
  } else if (action === "edit") {
    await editProvider(store, statusBar);
  } else if (action === "delete") {
    await deleteProvider(store, statusBar);
  } else if (action === "launch-current") {
    await launchCurrentProvider(store, skillStore);
  } else {
    await resetPresets(store, statusBar);
  }
}

async function addProvider(
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  onProvidersChanged?: () => void
): Promise<void> {
  const draft = await collectQuickProviderDraft(store);
  if (!draft) {
    return;
  }

  const token = authTypeRequiresToken(draft.authType)
      ? await promptSecret(
        "API Key or token",
        "Paste the provider API key or auth token. It will be stored in ~/.claude-code-provider-switcher/config.json."
      )
    : undefined;
  if (token === undefined && authTypeRequiresToken(draft.authType)) {
    return;
  }

  const tokenValidation = validateTokenRequirement(draft.authType, token);
  if (!tokenValidation.valid) {
    await vscode.window.showErrorMessage(tokenValidation.message ?? "API key or token is required.");
    return;
  }

  const provider = await store.addProvider(draft, token);
  await store.setActiveProviderId(provider.id);
  await statusBar.refresh();
  onProvidersChanged?.();

  const choice = await vscode.window.showInformationMessage(
    `Provider "${provider.name}" added.`,
    "Open Sidebar"
  );
  if (choice === "Open Sidebar") {
    await vscode.commands.executeCommand("workbench.view.extension.claudeCodeProviderSwitcher");
  }
}

async function editProvider(
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  onProvidersChanged?: () => void
): Promise<void> {
  const provider = await pickProvider(await store.getProviders(), "Edit Provider", "Choose a provider to edit");
  if (!provider) {
    return;
  }

  const draft = await collectProviderDraft(store, provider);
  if (!draft) {
    return;
  }

  const secretChange = await collectSecretChange(draft.authType);
  if (!secretChange) {
    return;
  }

  const updated = await store.updateProvider(provider.id, draft, secretChange);
  await statusBar.refresh();
  onProvidersChanged?.();
  await vscode.window.showInformationMessage(`Provider "${updated.name}" updated.`);
}

async function deleteProvider(
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  onProvidersChanged?: () => void
): Promise<void> {
  const provider = await pickProvider(await store.getProviders(), "Delete Provider", "Choose a provider to delete");
  if (!provider) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete provider "${provider.name}" and its stored secret? Running terminals will not be changed.`,
    { modal: true },
    "Delete"
  );

  if (confirmation !== "Delete") {
    return;
  }

  await store.deleteProvider(provider.id);
  await statusBar.refresh();
  onProvidersChanged?.();
  await vscode.window.showInformationMessage(`Provider "${provider.name}" deleted.`);
}

async function openProviderConfig(store: ProviderStore): Promise<void> {
  await store.ensureBuiltInPresets();
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(store.getConfigFilePath()));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function launchCurrentProvider(store: ProviderStore, skillStore: SkillStore): Promise<void> {
  const provider = await store.getActiveProvider();
  if (!provider) {
    await vscode.window.showWarningMessage("No current provider is selected.");
    return;
  }

  await launchProvider(store, skillStore, provider);
}

export async function resumeConversationWithCurrentProvider(
  store: ProviderStore,
  skillStore: SkillStore,
  sessionId: string
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    await vscode.window.showErrorMessage("Claude Code session id is invalid.");
    return;
  }

  const provider = await store.getActiveProvider();
  if (!provider) {
    await vscode.window.showWarningMessage("Select a provider before resuming a Claude Code conversation.");
    return;
  }

  await launchProvider(store, skillStore, provider, sessionId);
}

async function launchProvider(
  store: ProviderStore,
  skillStore: SkillStore,
  provider: ProviderProfile,
  resumeSessionId?: string
): Promise<void> {
  // Clean up stale generated files from previous launches (fire-and-forget).
  void cleanupStaleGeneratedFiles(path.join(os.homedir(), ".claude-code-provider-switcher")).catch(() => {});

  if (!vscode.workspace.workspaceFolders?.length) {
    const choice = await vscode.window.showWarningMessage(
      "No workspace folder is open. Claude Code will launch without a workspace directory.",
      "Launch Anyway",
      "Cancel"
    );
    if (choice !== "Launch Anyway") {
      return;
    }
  }

  if (getConfig().checkClaudeCliBeforeLaunch) {
    const cliAvailable = await checkClaudeCliAvailable();
    if (!cliAvailable) {
      const choice = await vscode.window.showWarningMessage(
        "Claude Code CLI was not found.\nInstall Claude Code and make sure the `claude` command is available in PATH.",
        "Launch Anyway",
        "Cancel"
      );
      if (choice !== "Launch Anyway") {
        return;
      }
    }
  }

  const token = await getOrPromptProviderToken(store, provider);
  if (token === undefined && authTypeRequiresToken(provider.authType)) {
    return;
  }

  const config = getConfig();
  const skillSelection = await getSkillLaunchSelection(skillStore);
  await launchClaudeCode(
    createVsCodeTerminalDependencies(
      config.terminalNameFormat,
      config.terminalLocation,
      config.conversationMode,
      config.permissionMode,
      skillSelection,
      resumeSessionId
    ),
    provider,
    token
  );
}

async function getOrPromptProviderToken(store: ProviderStore, provider: ProviderProfile): Promise<string | undefined> {
  if (!authTypeRequiresToken(provider.authType)) {
    return undefined;
  }

  const existingToken = await store.getToken(provider.id);
  if (existingToken?.trim()) {
    return existingToken;
  }

  const token = await promptSecret(
    `${provider.name} API Key or token`,
    `No API key/token is saved for ${provider.name}. Paste it once and it will be stored in ~/.claude-code-provider-switcher/config.json.`
  );
  if (token === undefined) {
    return undefined;
  }

  const validation = validateTokenRequirement(provider.authType, token);
  if (!validation.valid) {
    await vscode.window.showErrorMessage(validation.message ?? "API key or token is required.");
    return undefined;
  }

  await store.setToken(provider.id, token.trim());
  return token.trim();
}

async function getSkillLaunchSelection(skillStore: SkillStore): Promise<SkillLaunchSelection> {
  const [skills, autoUseSkill] = await Promise.all([skillStore.getInstalledSkills(), skillStore.getAutoUseSkill()]);
  if (skills.length === 0) {
    return { kind: "none" };
  }

  return {
    kind: "skills",
    directories: skills.map((skill) => skill.directory),
    autoUse: autoUseSkill
      ? {
          name: autoUseSkill.name,
          slashName: autoUseSkill.directory.split(/[\\/]/).filter(Boolean).pop() ?? autoUseSkill.name,
          directory: autoUseSkill.directory
        }
      : undefined
  };
}

async function resetPresets(
  store: ProviderStore,
  statusBar: ProviderStatusBar,
  onProvidersChanged?: () => void
): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Reset built-in presets to their default values? Custom providers will be kept.",
    { modal: true },
    "Reset Presets"
  );

  if (confirmation !== "Reset Presets") {
    return;
  }

  await store.resetBuiltInPresets();
  await statusBar.refresh();
  onProvidersChanged?.();
  await vscode.window.showInformationMessage("Built-in presets reset.");
}

async function collectProviderDraft(
  store: ProviderStore,
  existing?: ProviderProfile
): Promise<ProviderProfileDraft | undefined> {
  const draft = await collectQuickProviderDraft(store, existing);
  if (!draft) {
    return undefined;
  }

  // Offer to configure advanced options after essentials.
  const configureMore = await vscode.window.showQuickPick(
    [
      { label: "Save with defaults", description: "Skip advanced model and thinking settings" },
      { label: "Configure advanced", description: "Set per-variant models, effort level, and chat API" }
    ],
    { title: "Advanced Options", placeHolder: "Fine-tune model selections or save now" }
  );

  if (!configureMore) {
    return undefined;
  }

  if (configureMore.label === "Save with defaults") {
    return draft;
  }

  const model = await promptText("Default model", existing?.model, undefined, "deepseek-v4-pro[1m]");
  if (model === undefined) {
    return undefined;
  }

  const opusModel = await promptText("Opus model", existing?.opusModel, undefined, "Leave blank to use the default model");
  if (opusModel === undefined) {
    return undefined;
  }

  const sonnetModel = await promptText("Sonnet model", existing?.sonnetModel, undefined, "Leave blank to use the default model");
  if (sonnetModel === undefined) {
    return undefined;
  }

  const haikuModel = await promptText("Haiku model", existing?.haikuModel, undefined, "Leave blank to use the default model");
  if (haikuModel === undefined) {
    return undefined;
  }

  const subagentModel = await promptText("Subagent model", existing?.subagentModel, undefined, "Leave blank to use the default model");
  if (subagentModel === undefined) {
    return undefined;
  }

  const effortLevel = await promptEffortLevel(existing?.effortLevel);
  if (effortLevel.cancelled) {
    return undefined;
  }

  const chatBaseUrl = await promptText("Direct chat API base URL", existing?.chatBaseUrl, undefined, "Inferred from Base URL if blank");
  if (chatBaseUrl === undefined) {
    return undefined;
  }

  const chatModel = await promptText("Direct chat model", existing?.chatModel, undefined, "Inferred from model if blank");
  if (chatModel === undefined) {
    return undefined;
  }

  return {
    ...draft,
    model,
    opusModel,
    sonnetModel,
    haikuModel,
    subagentModel,
    effortLevel: effortLevel.value,
    chatBaseUrl,
    chatModel
  };
}

async function collectQuickProviderDraft(
  store: ProviderStore,
  existing?: ProviderProfile
): Promise<ProviderProfileDraft | undefined> {
  const name = await promptText(
    "Provider name",
    existing?.name,
    (value) => validateProviderName(value).message,
    "e.g. DeepSeek, Kimi, Custom"
  );
  if (name === undefined) {
    return undefined;
  }

  const duplicateConfirmed = await confirmDuplicateName(store, name, existing?.id);
  if (!duplicateConfirmed) {
    return undefined;
  }

  const authType = await promptAuthType(existing?.authType);
  if (!authType) {
    return undefined;
  }

  const baseUrl = await promptText(
    "Base URL",
    existing?.baseUrl,
    (value) => validateBaseUrl(value, true).message,
    "https://api.deepseek.com/anthropic"
  );
  if (baseUrl === undefined) {
    return undefined;
  }

  return {
    name,
    authType,
    baseUrl
  };
}

async function collectSecretChange(authType: ProviderAuthType): Promise<SecretChange | undefined> {
  const selected = await vscode.window.showQuickPick(
    [
      { label: "Keep existing API key", change: { kind: "keep" } as SecretChange },
      { label: "Replace API key", change: { kind: "replace" } as const },
      { label: "Remove API key", change: { kind: "remove" } as SecretChange }
    ],
    { title: "API Key", placeHolder: "Choose how to handle the stored secret" }
  );

  if (!selected) {
    return undefined;
  }

  if (selected.change.kind !== "replace") {
    return selected.change;
  }

  const token = await promptSecret(
    "New API Key or token",
    "Paste the replacement API key or auth token. The previous secret will be overwritten."
  );
  if (token === undefined) {
    return undefined;
  }

  const validation = validateTokenRequirement(authType, token);
  if (!validation.valid) {
    await vscode.window.showErrorMessage(validation.message ?? "API key or token is required.");
    return undefined;
  }

  return { kind: "replace", token };
}

async function promptText(
  title: string,
  value?: string,
  validateInput?: (value: string) => string | undefined,
  placeholder?: string
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    value: value ?? "",
    placeHolder: placeholder,
    ignoreFocusOut: true,
    validateInput
  });
}

async function promptSecret(title: string, prompt?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    prompt,
    placeHolder: "Stored in ~/.claude-code-provider-switcher/config.json",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "API key or token is required.")
  });
}

async function promptAuthType(current?: ProviderAuthType): Promise<ProviderAuthType | undefined> {
  const selected = await vscode.window.showQuickPick(
    authTypes.map((item) => ({
      ...item,
      picked: item.authType === current
    })),
    { title: "Auth Type", placeHolder: "Choose how Claude Code should receive credentials" }
  );

  return selected?.authType;
}

async function promptEffortLevel(current?: ClaudeEffortLevel): Promise<{ cancelled: boolean; value?: ClaudeEffortLevel }> {
  const selected = await vscode.window.showQuickPick(
    effortLevels.map((item) => ({
      ...item,
      picked: item.effortLevel === current || (!item.effortLevel && !current)
    })),
    { title: "Effort Level", placeHolder: "Choose optional effort level" }
  );

  if (!selected) {
    return { cancelled: true };
  }

  return { cancelled: false, value: selected.effortLevel };
}

async function confirmDuplicateName(store: ProviderStore, name: string, currentId?: string): Promise<boolean> {
  const providers = await store.getProviders();
  const duplicate = providers.find(
    (provider) => provider.id !== currentId && provider.name.trim().toLowerCase() === name.trim().toLowerCase()
  );

  if (!duplicate) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `A provider named "${name}" already exists. Continue anyway?`,
    "Continue",
    "Cancel"
  );

  return choice === "Continue";
}
