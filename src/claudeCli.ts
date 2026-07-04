import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

let cachedExecutable: string | undefined;
let cacheResolved = false;

export async function resolveClaudeExecutable(override?: string): Promise<string | undefined> {
  // An explicit user-configured path always wins (if it exists), bypassing auto-detection.
  const trimmedOverride = override?.trim();
  if (trimmedOverride && (await fileExists(trimmedOverride))) {
    return trimmedOverride;
  }

  if (cacheResolved) {
    if (!cachedExecutable) {
      return undefined;
    }

    if (await fileExists(cachedExecutable)) {
      return cachedExecutable;
    }

    // Cached executable has been uninstalled — fall through to re-resolve.
    cacheResolved = false;
    cachedExecutable = undefined;
  }

  const resolved = await doResolveClaudeExecutable();
  cachedExecutable = resolved;
  cacheResolved = true;
  return resolved;
}

async function doResolveClaudeExecutable(): Promise<string | undefined> {
  if (await canRunClaude("claude")) {
    return "claude";
  }

  for (const candidate of getKnownClaudeExecutableCandidates()) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return findWingetClaudeExecutable();
}

export async function canRunClaude(executable: string, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    // shell: true is required on Windows so that a bare "claude" resolves to
    // "claude.cmd" (npm global) via PATH + PATHEXT. Without it, Node's execFile
    // cannot run .cmd/.bat files and the availability check always fails.
    const child = execFile(executable, ["--version"], { timeout: timeoutMs, shell: true }, (error) => {
      resolve(!error);
    });

    child.on("error", () => resolve(false));
  });
}

function getKnownClaudeExecutableCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  const candidates: string[] = [];

  if (localAppData) {
    candidates.push(
      path.join(localAppData, "Microsoft", "WindowsApps", "claude.exe"),
      path.join(localAppData, "Programs", "Claude", "claude.exe")
    );
  }

  if (appData) {
    // npm global bin on Windows (e.g. `npm install -g @anthropic-ai/claude-code`)
    candidates.push(
      path.join(appData, "npm", "claude.cmd"),
      path.join(appData, "npm", "claude.ps1")
    );
  }

  return candidates;
}

async function findWingetClaudeExecutable(): Promise<string | undefined> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return undefined;
  }

  const packagesDirectory = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  try {
    const entries = await fs.readdir(packagesDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("Anthropic.ClaudeCode_")) {
        continue;
      }

      const candidate = path.join(packagesDirectory, entry.name, "claude.exe");
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
