import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyDir,
  normalizeRelativePath,
  readEditableFiles,
  removeDir,
  safeId,
  walkFiles
} from "./util.mjs";

export async function createSandbox(task) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `rsi-${safeId(task.id)}-`));
  const workspaceDir = path.join(root, "workspace");
  await copyDir(task.workspaceDir, workspaceDir);

  const testsDir = path.join(root, "tests");
  await copyDir(task.publicTestsDir, testsDir);

  if (task.benchmark) {
    await fs.copyFile(task.benchmarkFile, path.join(root, path.basename(task.benchmarkFile)));
  }

  await fs.writeFile(
    path.join(root, "TASK.md"),
    `# ${task.title}\n\n${task.prompt}\n\n## Editable files\n\n${task.editable.map((file) => `- \`${file}\``).join("\n")}\n`,
    "utf8"
  );

  return { root, workspaceDir, testsDir };
}

export function validateProposal(task, files) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("Proposal must contain a \"files\" object mapping editable paths to full file contents.");
  }

  const entries = Object.entries(files);
  if (!entries.length) {
    throw new Error("Proposal did not include any files.");
  }
  if (entries.length > task.maxFiles) {
    throw new Error(`Proposal changed ${entries.length} files, exceeding the limit of ${task.maxFiles}.`);
  }

  const allowed = new Set(task.editable);
  const normalized = {};
  for (const [rawPath, content] of entries) {
    const relative = normalizeRelativePath(rawPath);
    if (!allowed.has(relative)) {
      throw new Error(`Proposal attempted to modify a non-editable path: ${relative}`);
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`Proposal file is empty or not a string: ${relative}`);
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > task.maxFileBytes) {
      throw new Error(`Proposal file ${relative} is ${bytes} bytes; limit is ${task.maxFileBytes}.`);
    }
    normalized[relative] = content;
  }

  return normalized;
}

export async function applyFiles(workspaceDir, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(workspaceDir, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
}

export async function readWorkspaceTree(sandbox) {
  return walkFiles(sandbox.workspaceDir);
}

export async function readCurrentEditable(task) {
  return readEditableFiles(task.workspaceDir, task.editable);
}

export async function applyToTarget(task, files, targetDir) {
  const root = path.resolve(targetDir);
  const normalized = validateProposal(task, files);
  for (const [relative, content] of Object.entries(normalized)) {
    const target = path.join(root, ...relative.split("/"));
    const resolved = path.resolve(target);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Refusing to write outside target directory: ${relative}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return Object.keys(normalized);
}

export async function cleanupSandbox(sandbox) {
  await removeDir(sandbox.root);
}
