import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const defaultSkipNames = new Set(["node_modules", ".git", "runs", ".cache"]);

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readText(file) {
  return fs.readFile(file, "utf8");
}

export async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, "utf8");
}

export async function copyDir(source, destination, options = {}) {
  const skipNames = options.skipNames ?? defaultSkipNames;
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) {
      continue;
    }

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to, options);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
    // Symlinks are deliberately ignored: a benchmark task must not escape its
    // sandbox by pointing at the host filesystem.
  }
}

export async function walkFiles(root, options = {}) {
  const skipNames = options.skipNames ?? defaultSkipNames;
  const files = [];

  async function visit(directory, relative) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (skipNames.has(entry.name)) {
        continue;
      }

      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(full, nextRelative);
      } else if (entry.isFile()) {
        files.push(nextRelative);
      }
    }
  }

  await visit(root, "");
  return files;
}

export async function readEditableFiles(workspaceDir, editablePaths) {
  const files = {};
  for (const relative of editablePaths) {
    files[relative] = await fs.readFile(path.join(workspaceDir, relative), "utf8");
  }
  return files;
}

export function normalizeRelativePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A file path must be a non-empty string.");
  }

  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Absolute paths are not allowed: ${value}`);
  }

  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe relative path: ${value}`);
  }

  return parts.join("/");
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeId(value) {
  const result = String(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return result || "task";
}

export function truncate(value, maximum = 4000) {
  const text = String(value ?? "");
  if (text.length <= maximum) {
    return text;
  }
  return `${text.slice(0, maximum)}\n...[truncated ${text.length - maximum} characters]`;
}

export function median(values) {
  if (!values.length) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function stripCodeFences(value) {
  return String(value ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export function extractJsonObject(value) {
  const text = String(value ?? "");
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error("Response did not contain a valid JSON object.");
}

export async function removeDir(target) {
  await fs.rm(target, { recursive: true, force: true });
}

export async function appendJsonLine(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonLines(file) {
  let content;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter((value) => value !== undefined);
}

export function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/u)
    .filter((token) => token.length >= 2);
}
