import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveClaudeExecutable } from "./claudeCli";
import { ProviderProfile, TerminalPermissionMode } from "./types";
import { authTypeRequiresToken } from "./validation";

export type TerminalEnv = Record<string, string | null | undefined>;

export type SkillLaunchSelection =
  | { kind: "none" }
  | { kind: "skill"; directory: string }
  | { kind: "skills"; directories: string[]; autoUse?: AutoUseSkill };

export interface AutoUseSkill {
  name: string;
  slashName: string;
  directory: string;
}

export interface TerminalLike {
  show(): void;
  sendText(text: string, addNewLine?: boolean): void;
}

export interface TerminalLauncherDependencies {
  createTerminal(options: vscode.TerminalOptions): TerminalLike;
  getWorkspaceFolderForActiveEditor(): string | undefined;
  getFirstWorkspaceFolder(): string | undefined;
  terminalNameFormat: string;
  terminalLocation: "editor" | "panel";
  conversationMode: "fresh" | "continue" | "resumePicker";
  permissionMode: TerminalPermissionMode;
  resumeSessionId?: string;
  skillSelection: SkillLaunchSelection;
  claudeExecutable?: string;
}

const clearedClaudeEnv: TerminalEnv = {
  ANTHROPIC_BASE_URL: null,
  ANTHROPIC_AUTH_TOKEN: null,
  ANTHROPIC_API_KEY: null,
  ANTHROPIC_MODEL: null,
  ANTHROPIC_DEFAULT_OPUS_MODEL: null,
  ANTHROPIC_DEFAULT_SONNET_MODEL: null,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: null,
  CLAUDE_CODE_SUBAGENT_MODEL: null,
  CLAUDE_CODE_EFFORT_LEVEL: null,
  CLAUDE_CODE_PROVIDER_SWITCHER_PERMISSION_MODE: null
};

export function buildClaudeTerminalEnv(provider: ProviderProfile, token: string | undefined): TerminalEnv {
  if (authTypeRequiresToken(provider.authType) && !token?.trim()) {
    throw new Error("API key or token is missing for the selected provider.");
  }

  const env: TerminalEnv = { ...clearedClaudeEnv };

  setEnv(env, "ANTHROPIC_BASE_URL", provider.baseUrl);
  setEnv(env, "ANTHROPIC_MODEL", provider.model);
  setEnv(env, "ANTHROPIC_DEFAULT_OPUS_MODEL", provider.opusModel);
  setEnv(env, "ANTHROPIC_DEFAULT_SONNET_MODEL", provider.sonnetModel);
  setEnv(env, "ANTHROPIC_DEFAULT_HAIKU_MODEL", provider.haikuModel);
  setEnv(env, "CLAUDE_CODE_SUBAGENT_MODEL", provider.subagentModel);
  setEnv(env, "CLAUDE_CODE_EFFORT_LEVEL", provider.effortLevel);

  if (provider.authType === "anthropic-auth-token") {
    setEnv(env, "ANTHROPIC_AUTH_TOKEN", token);
  } else if (provider.authType === "anthropic-api-key") {
    setEnv(env, "ANTHROPIC_API_KEY", token);
  }

  return env;
}

export function createTerminalName(format: string, providerName: string): string {
  const fallback = "CC · ${provider}";
  const safeProvider = sanitizeTerminalText(providerName) || "Provider";
  const safeFormat = sanitizeTerminalText(format) || fallback;
  const name = safeFormat.replace(/\$\{provider\}/g, safeProvider).trim();
  return name || `CC · ${safeProvider}`;
}

export function createClaudeCommand(
  conversationMode: TerminalLauncherDependencies["conversationMode"],
  resumeSessionId?: string,
  skillSelection: SkillLaunchSelection = { kind: "none" },
  claudeExecutable = "claude",
  permissionMode: TerminalPermissionMode = "requestApproval"
): string {
  const executable = claudeExecutable === "claude" ? "claude" : quoteShellArgument(claudeExecutable);
  return [executable, ...createClaudeArguments(conversationMode, resumeSessionId, skillSelection, permissionMode).map(quoteArgumentIfNeeded)].join(
    " "
  );
}

function createClaudeArguments(
  conversationMode: TerminalLauncherDependencies["conversationMode"],
  resumeSessionId: string | undefined,
  skillSelection: SkillLaunchSelection,
  permissionMode: TerminalPermissionMode
): string[] {
  const args: string[] = [];
  if (skillSelection.kind === "skill") {
    args.push("--plugin-dir", skillSelection.directory);
  } else if (skillSelection.kind === "skills") {
    for (const directory of skillSelection.directories) {
      args.push("--plugin-dir", directory);
    }
    if (skillSelection.autoUse) {
      args.push("--append-system-prompt", createAutoUseSkillPrompt(skillSelection.autoUse));
    }
  }

  args.push("--permission-mode", toClaudePermissionMode(permissionMode));

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
    return args;
  }

  if (conversationMode === "continue") {
    args.push("--continue");
    return args;
  }

  if (conversationMode === "resumePicker") {
    args.push("--resume");
    return args;
  }

  return args;
}

export async function checkClaudeCliAvailable(override?: string): Promise<boolean> {
  return (await resolveClaudeExecutable(override)) !== undefined;
}

export async function launchClaudeCode(
  dependencies: TerminalLauncherDependencies,
  provider: ProviderProfile,
  token: string | undefined
): Promise<void> {
  const cwd = dependencies.getWorkspaceFolderForActiveEditor() ?? dependencies.getFirstWorkspaceFolder();
  const env = buildClaudeTerminalEnv(provider, token);
  setEnv(env, "CLAUDE_CODE_PROVIDER_SWITCHER_PERMISSION_MODE", dependencies.permissionMode);
  const terminal = dependencies.createTerminal({
    name: createTerminalName(dependencies.terminalNameFormat, provider.name),
    cwd,
    env,
    location: toVsCodeTerminalLocation(dependencies.terminalLocation),
    isTransient: true,
    iconPath: new vscode.ThemeIcon("sparkle")
  });

  terminal.show();
  const claudeExecutable = dependencies.claudeExecutable ?? (await resolveClaudeExecutable(dependencies.claudeExecutable)) ?? "claude";
  const skillSelection = await prepareSkillLaunchSelection(dependencies.skillSelection);
  const args = createClaudeArguments(
    dependencies.conversationMode,
    dependencies.resumeSessionId,
    skillSelection,
    dependencies.permissionMode
  );
  const command =
    shouldUseLauncherScript(skillSelection, args) || args.join(" ").length > 180
      ? await createPowerShellLauncherCommand(claudeExecutable, args)
      : createClaudeCommand(
          dependencies.conversationMode,
          dependencies.resumeSessionId,
          skillSelection,
          claudeExecutable,
          dependencies.permissionMode
        );
  terminal.sendText(command, true);
}

export function createVsCodeTerminalDependencies(
  terminalNameFormat: string,
  terminalLocation: "editor" | "panel",
  conversationMode: TerminalLauncherDependencies["conversationMode"],
  permissionMode: TerminalPermissionMode,
  skillSelection: SkillLaunchSelection,
  resumeSessionId?: string,
  claudeExecutable?: string
): TerminalLauncherDependencies {
  return {
    terminalNameFormat,
    terminalLocation,
    conversationMode,
    permissionMode,
    resumeSessionId,
    skillSelection,
    claudeExecutable,
    createTerminal: (options) => vscode.window.createTerminal(options),
    getWorkspaceFolderForActiveEditor: () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return undefined;
      }

      return vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath;
    },
    getFirstWorkspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  };
}

function quoteShellArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quoteArgumentIfNeeded(value: string): string {
  return /[\s"]/u.test(value) ? quoteShellArgument(value) : value;
}

function toVsCodeTerminalLocation(location: "editor" | "panel"): vscode.TerminalLocation {
  return location === "editor" ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel;
}

function toClaudePermissionMode(permissionMode: TerminalPermissionMode): "bypassPermissions" | "default" {
  return permissionMode === "fullAccess" ? "bypassPermissions" : "default";
}

function createAutoUseSkillPrompt(skill: AutoUseSkill): string {
  return [
    `For this Claude Code session, automatically use the selected skill /${skill.slashName} (${skill.name}) when it fits the user's task.`,
    "Treat this selected skill as the default working mode for relevant requests.",
    "Do not wait for the user to type the slash command before applying the skill's instructions."
  ].join(" ");
}

async function prepareSkillLaunchSelection(skillSelection: SkillLaunchSelection): Promise<SkillLaunchSelection> {
  if (skillSelection.kind !== "skills" || skillSelection.directories.length === 0) {
    return skillSelection;
  }

  const plugin = await createAggregateSkillPlugin(skillSelection.directories);
  return {
    kind: "skills",
    directories: [plugin.directory],
    autoUse: skillSelection.autoUse
      ? {
          ...skillSelection.autoUse,
          slashName: plugin.slashNames.get(normalizeDirectoryKey(skillSelection.autoUse.directory)) ?? skillSelection.autoUse.slashName
        }
      : undefined
  };
}

async function createAggregateSkillPlugin(skillDirectories: string[]): Promise<{ directory: string; slashNames: Map<string, string> }> {
  const root = path.join(os.homedir(), ".claude-code-provider-switcher", "generated-plugins", `selected-skills-${Date.now()}`);
  const pluginConfigDirectory = path.join(root, ".claude-plugin");
  const skillsDirectory = path.join(root, "skills");
  await fs.mkdir(pluginConfigDirectory, { recursive: true });
  await fs.mkdir(skillsDirectory, { recursive: true });

  const slashNames = new Map<string, string>();
  const usedNames = new Set<string>();
  const skillEntries: string[] = [];
  for (const skillDirectory of uniqueDirectories(skillDirectories)) {
    const slashName = createUniqueSlashName(path.basename(skillDirectory), usedNames);
    const destination = path.join(skillsDirectory, slashName);
    await fs.cp(skillDirectory, destination, { recursive: true, force: true });
    slashNames.set(normalizeDirectoryKey(skillDirectory), slashName);
    skillEntries.push(`./skills/${slashName}`);
  }

  await fs.writeFile(
    path.join(pluginConfigDirectory, "plugin.json"),
    `${JSON.stringify(
      {
        name: "provider-switcher-selected-skills",
        version: "0.1.0",
        description: "Generated session plugin for Claude Code Provider Switcher selected skills.",
        author: {
          name: "Claude Code Provider Switcher"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(pluginConfigDirectory, "marketplace.json"),
    `${JSON.stringify(
      {
        name: "provider-switcher-selected-skills",
        owner: {
          name: "Claude Code Provider Switcher"
        },
        description: "Generated session plugin for selected skills.",
        plugins: [
          {
            name: "provider-switcher-selected-skills",
            source: "./",
            description: "Selected skills for this Claude Code session.",
            version: "0.1.0",
            skills: skillEntries
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { directory: root, slashNames };
}

async function createPowerShellLauncherCommand(claudeExecutable: string, args: string[]): Promise<string> {
  const directory = path.join(os.homedir(), ".claude-code-provider-switcher", "launchers");
  await fs.mkdir(directory, { recursive: true });
  const scriptPath = path.join(directory, `claude-launch-${Date.now()}.ps1`);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$claude = ${toPowerShellSingleQuotedString(claudeExecutable)}`,
    "$claudeArgs = @(",
    ...args.map((argument) => `  ${toPowerShellSingleQuotedString(argument)}`),
    ")",
    "& $claude @claudeArgs",
    "exit $LASTEXITCODE"
  ];
  await fs.writeFile(scriptPath, `${lines.join("\n")}\n`, "utf8");
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteShellArgument(scriptPath)}`;
}

function shouldUseLauncherScript(skillSelection: SkillLaunchSelection, args: string[]): boolean {
  return skillSelection.kind === "skills" || args.some((arg) => arg.length > 80);
}

function toPowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function uniqueDirectories(directories: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const directory of directories) {
    const key = normalizeDirectoryKey(directory);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(directory);
  }

  return unique;
}

function createUniqueSlashName(value: string, usedNames: Set<string>): string {
  const base =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill";
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function normalizeDirectoryKey(directory: string): string {
  return path.normalize(directory).toLowerCase();
}

function setEnv(env: TerminalEnv, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    env[key] = trimmed;
  }
}

function sanitizeTerminalText(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
}

/**
 * Removes stale generated plugin directories and launcher scripts so disk
 * usage does not grow without bound.  Safe to call as a fire-and-forget
 * side-effect — individual I/O errors are silently ignored.
 */
export async function cleanupStaleGeneratedFiles(
  baseDirectory: string,
  maxAgeMs = 60 * 60 * 1000,
  now = Date.now()
): Promise<void> {
  const targets = [path.join(baseDirectory, "generated-plugins"), path.join(baseDirectory, "launchers")];
  for (const target of targets) {
    let entries: string[];
    try {
      entries = await fs.readdir(target);
    } catch {
      continue; // directory may not exist yet — that's fine
    }

    for (const name of entries) {
      const full = path.join(target, name);
      try {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.rm(full, { recursive: true, force: true });
        }
      } catch {
        // skip individual unreadable / locked entries
      }
    }
  }
}
