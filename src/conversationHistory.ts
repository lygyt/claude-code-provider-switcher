import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ClaudeConversation {
  sessionId: string;
  title: string;
  projectName: string;
  filePath: string;
  updatedAt?: string;
}

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaudeConversationHistoryProvider implements vscode.TreeDataProvider<ConversationTreeItem> {
  private readonly changed = new vscode.EventEmitter<ConversationTreeItem | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;

  public refresh(): void {
    this.changed.fire(undefined);
  }

  public getTreeItem(element: ConversationTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<ConversationTreeItem[]> {
    const conversations = await loadClaudeConversations();
    if (conversations.length === 0) {
      return [
        ConversationTreeItem.empty(
          "No Claude Code history found",
          "Start a Claude Code conversation once, then refresh this view."
        )
      ];
    }

    return conversations.map((conversation) => ConversationTreeItem.conversation(conversation));
  }
}

export class ConversationTreeItem extends vscode.TreeItem {
  private constructor(label: string, collapsibleState = vscode.TreeItemCollapsibleState.None) {
    super(label, collapsibleState);
  }

  public static conversation(conversation: ClaudeConversation): ConversationTreeItem {
    const item = new ConversationTreeItem(conversation.title);
    item.description = conversation.projectName;
    item.tooltip = [
      conversation.title,
      `Project: ${conversation.projectName}`,
      `Session: ${conversation.sessionId}`,
      conversation.updatedAt ? `Updated: ${conversation.updatedAt}` : undefined
    ]
      .filter(Boolean)
      .join("\n");
    item.iconPath = new vscode.ThemeIcon("history");
    item.contextValue = "claudeConversation";
    item.command = {
      command: "claudeCodeProviderSwitcher.resumeConversation",
      title: "Resume Claude Code Conversation",
      arguments: [conversation.sessionId]
    };
    return item;
  }

  public static empty(label: string, detail: string): ConversationTreeItem {
    const item = new ConversationTreeItem(label);
    item.description = detail;
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
  }
}

export async function loadClaudeConversations(root = path.join(os.homedir(), ".claude", "projects")): Promise<ClaudeConversation[]> {
  const files = await listJsonlFiles(root);
  const conversations = await Promise.all(files.map((file) => readConversationFile(file)));

  return conversations
    .filter((conversation): conversation is ClaudeConversation => conversation !== undefined)
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

async function listJsonlFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          return listJsonlFiles(entryPath);
        }

        return entry.isFile() && entry.name.endsWith(".jsonl") ? [entryPath] : [];
      })
    );
    return nested.flat();
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

async function readConversationFile(filePath: string): Promise<ClaudeConversation | undefined> {
  const sessionId = path.basename(filePath, ".jsonl");
  if (!sessionIdPattern.test(sessionId)) {
    return undefined;
  }

  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  let title: string | undefined;
  let updatedAt: string | undefined;

  for (const line of lines) {
    const parsed = parseJsonObject(line);
    if (!parsed) {
      continue;
    }

    const timestamp = readString(parsed.timestamp);
    if (timestamp) {
      updatedAt = timestamp;
    }

    title ??= extractUserText(parsed);
  }

  const projectName = decodeProjectName(path.basename(path.dirname(filePath)));
  return {
    sessionId,
    title: trimTitle(title ?? sessionId),
    projectName,
    filePath,
    updatedAt
  };
}

function extractUserText(value: Record<string, unknown>): string | undefined {
  if (value.type !== "user") {
    return undefined;
  }

  const message = readRecord(value.message);
  if (!message || message.role !== "user") {
    return undefined;
  }

  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = readRecord(part);
        return record ? readString(record.text) : undefined;
      })
      .filter(Boolean)
      .join(" ");
  }

  return undefined;
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return readRecord(parsed);
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function trimTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function decodeProjectName(value: string): string {
  const trimmed = value.replace(/^-+/, "").replace(/-/g, path.sep);
  return trimmed || "Unknown project";
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
