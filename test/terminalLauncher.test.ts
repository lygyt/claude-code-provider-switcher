import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  TerminalLocation: {
    Panel: 1,
    Editor: 2
  },
  ThemeIcon: class ThemeIcon {
    public constructor(public readonly id: string) {}
  }
}));

import {
  buildClaudeTerminalEnv,
  cleanupStaleGeneratedFiles,
  createClaudeCommand,
  createTerminalName,
  launchClaudeCode,
  TerminalLauncherDependencies,
  TerminalLike
} from "../src/terminalLauncher";
import { ProviderProfile } from "../src/types";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function setMtimeMs(filePath: string, mtimeMs: number): Promise<void> {
  await fs.utimes(filePath, new Date(), new Date(mtimeMs));
}

function provider(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: "provider-id",
    name: "DeepSeek",
    authType: "anthropic-auth-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("terminalLauncher", () => {
  it("maps provider fields to Claude Code environment variables", () => {
    const env = buildClaudeTerminalEnv(
      provider({
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-chat",
        opusModel: "opus",
        sonnetModel: "sonnet",
        haikuModel: "haiku",
        subagentModel: "subagent",
        effortLevel: "high"
      }),
      "token"
    );

    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("token");
    expect(env.ANTHROPIC_MODEL).toBe("deepseek-chat");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("opus");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("sonnet");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("haiku");
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("subagent");
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
  });

  it("clears old third-party env values when switching back to OAuth", () => {
    const env = buildClaudeTerminalEnv(provider({ name: "Anthropic Official", authType: "oauth" }), undefined);

    expect(env.ANTHROPIC_BASE_URL).toBeNull();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeNull();
    expect(env.ANTHROPIC_API_KEY).toBeNull();
    expect(env.ANTHROPIC_MODEL).toBeNull();
  });

  it("uses ANTHROPIC_API_KEY for anthropic-api-key auth", () => {
    const env = buildClaudeTerminalEnv(provider({ authType: "anthropic-api-key" }), "api-key");

    expect(env.ANTHROPIC_API_KEY).toBe("api-key");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeNull();
  });

  it("does not inject a token for OAuth", () => {
    const env = buildClaudeTerminalEnv(provider({ authType: "oauth" }), "ignored");

    expect(env.ANTHROPIC_AUTH_TOKEN).toBeNull();
    expect(env.ANTHROPIC_API_KEY).toBeNull();
  });

  it("generates a safe terminal name", () => {
    expect(createTerminalName("CC · ${provider}", "DeepSeek")).toBe("CC · DeepSeek");
    expect(createTerminalName("", "")).toBe("CC · Provider");
  });

  it("creates a terminal and runs claude", async () => {
    const terminal: TerminalLike = {
      show: vi.fn(),
      sendText: vi.fn()
    };
    const createTerminal = vi.fn(() => terminal);
    const dependencies: TerminalLauncherDependencies = {
      createTerminal,
      getWorkspaceFolderForActiveEditor: () => "E:\\project",
      getFirstWorkspaceFolder: () => undefined,
      terminalNameFormat: "CC · ${provider}",
      terminalLocation: "editor",
      conversationMode: "continue",
      permissionMode: "requestApproval",
      skillSelection: { kind: "none" },
      claudeExecutable: "claude"
    };

    await launchClaudeCode(dependencies, provider({}), "token");

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CC · DeepSeek",
        cwd: "E:\\project",
        location: 2,
        isTransient: true
      })
    );
    expect(terminal.show).toHaveBeenCalled();
    expect(terminal.sendText).toHaveBeenCalledWith("claude --permission-mode default --continue", true);
  });

  it("generates Claude commands for conversation modes", () => {
    expect(createClaudeCommand("fresh")).toBe("claude --permission-mode default");
    expect(createClaudeCommand("continue")).toBe("claude --permission-mode default --continue");
    expect(createClaudeCommand("resumePicker")).toBe("claude --permission-mode default --resume");
    expect(createClaudeCommand("continue", "123e4567-e89b-12d3-a456-426614174000")).toBe(
      "claude --permission-mode default --resume 123e4567-e89b-12d3-a456-426614174000"
    );
    expect(createClaudeCommand("continue", undefined, { kind: "skill", directory: "C:\\Claude Skills\\reviewer" })).toBe(
      'claude --plugin-dir "C:\\Claude Skills\\reviewer" --permission-mode default --continue'
    );
    expect(
      createClaudeCommand("continue", undefined, {
        kind: "skills",
        directories: ["C:\\Claude Skills\\reviewer", "C:\\Claude Skills\\writer"]
      })
    ).toBe(
      'claude --plugin-dir "C:\\Claude Skills\\reviewer" --plugin-dir "C:\\Claude Skills\\writer" --permission-mode default --continue'
    );
    expect(
      createClaudeCommand("fresh", undefined, {
        kind: "skills",
        directories: ["C:\\Claude Skills\\reviewer"],
        autoUse: {
          name: "Code Reviewer",
          slashName: "reviewer",
          directory: "C:\\Claude Skills\\reviewer"
        }
      })
    ).toContain('--append-system-prompt "For this Claude Code session, automatically use the selected skill /reviewer');
    expect(createClaudeCommand("fresh", undefined, { kind: "none" }, "C:\\Claude\\claude.exe")).toBe(
      '"C:\\Claude\\claude.exe" --permission-mode default'
    );
    expect(createClaudeCommand("fresh", undefined, { kind: "none" }, "claude", "fullAccess")).toBe(
      "claude --permission-mode bypassPermissions"
    );
  });

  it("removes stale generated plugin dirs and keeps fresh ones", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-cleanup-"));
    const pluginDir = path.join(tempRoot, "generated-plugins");
    const launcherDir = path.join(tempRoot, "launchers");
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.mkdir(launcherDir, { recursive: true });

    const freshTime = Date.now();
    const staleTime = freshTime - 61 * 60 * 1000; // 61 minutes ago

    const freshPlugin = path.join(pluginDir, "fresh-skill");
    const stalePlugin = path.join(pluginDir, "stale-skill");
    const freshLauncher = path.join(launcherDir, "fresh.ps1");
    const staleLauncher = path.join(launcherDir, "stale.ps1");

    await fs.mkdir(freshPlugin);
    await fs.mkdir(stalePlugin);
    await fs.writeFile(freshLauncher, "echo fresh", "utf8");
    await fs.writeFile(staleLauncher, "echo stale", "utf8");

    // Pin timestamps: fresh < 15s old, stale ~61min old
    await setMtimeMs(freshPlugin, freshTime - 10_000);
    await setMtimeMs(stalePlugin, staleTime);
    await setMtimeMs(freshLauncher, freshTime - 5_000);
    await setMtimeMs(staleLauncher, staleTime + 1_000);

    const now = freshTime;
    await cleanupStaleGeneratedFiles(tempRoot, 60 * 60 * 1000, now);

    // fresh entries survive
    const plugins = await fs.readdir(pluginDir);
    expect(plugins).toEqual(["fresh-skill"]);

    const launchers = await fs.readdir(launcherDir);
    expect(launchers).toEqual(["fresh.ps1"]);
  });
});
