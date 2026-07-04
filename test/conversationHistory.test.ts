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
    public constructor(
      public readonly label: string,
      public readonly collapsibleState?: number
    ) {}
  },
  TreeItemCollapsibleState: {
    None: 0
  }
}));

import { loadClaudeConversations } from "../src/conversationHistory";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("conversationHistory", () => {
  it("loads Claude Code conversations from jsonl session files", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-history-"));
    const projectDir = path.join(tempRoot, "-Users-DELL-project");
    await fs.mkdir(projectDir, { recursive: true });

    const sessionId = "123e4567-e89b-12d3-a456-426614174000";
    await fs.writeFile(
      path.join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-29T01:00:00.000Z",
          message: { role: "user", content: [{ type: "text", text: "Build the provider switcher" }] }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-29T01:01:00.000Z",
          message: { role: "assistant", content: "Done" }
        })
      ].join("\n"),
      "utf8"
    );

    const conversations = await loadClaudeConversations(tempRoot);

    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      sessionId,
      title: "Build the provider switcher",
      projectName: `Users${path.sep}DELL${path.sep}project`,
      updatedAt: "2026-06-29T01:01:00.000Z"
    });
  });

  it("returns an empty list when the history directory does not exist", async () => {
    const conversations = await loadClaudeConversations(path.join(os.tmpdir(), "missing-claude-history"));

    expect(conversations).toEqual([]);
  });
});
