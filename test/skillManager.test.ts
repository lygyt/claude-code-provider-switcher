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
    None: 0,
    Collapsed: 1,
    Expanded: 2
  },
  workspace: {
    workspaceFolders: []
  }
}));

import {
  createDefaultSkillConfig,
  loadClaudeSkillsFromRoots,
  loadConfiguredSkills,
  parseGithubSkillUrl,
  SkillStore
} from "../src/skillManager";
import { GlobalStateLike } from "../src/types";

class MemoryGlobalState implements GlobalStateLike {
  public readonly values = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }

    this.values.set(key, value);
  }
}

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("skillManager", () => {
  it("loads downloaded Claude skills from skill directories", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-skills-"));
    const skillDir = path.join(tempRoot, "reviewer");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "plugin.json"),
      JSON.stringify({ name: "reviewer", displayName: "Code Reviewer", description: "Reviews code changes." }),
      "utf8"
    );

    const skills = await loadClaudeSkillsFromRoots([{ directory: tempRoot, scope: "user" }]);

    expect(skills).toEqual([
      {
        id: `user:${skillDir}`,
        name: "Code Reviewer",
        directory: skillDir,
        scope: "user",
        description: "Reviews code changes."
      }
    ]);
  });

  it("stores multiple installed skills persistently", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-installed-skills-"));
    const configFilePath = path.join(tempRoot, ".claude-code-provider-switcher", "skills.json");
    const writerDirectory = path.join(tempRoot, "writer");
    const reviewerDirectory = path.join(tempRoot, "reviewer");
    const globalState = new MemoryGlobalState();
    const store = new SkillStore(globalState, configFilePath);

    await store.setInstalledSkillDirectories([writerDirectory, reviewerDirectory, writerDirectory]);

    expect(await store.getInstalledSkillDirectories()).toEqual([writerDirectory, reviewerDirectory]);

    await store.useSkillDirectory(writerDirectory);
    await store.useSkillDirectory(writerDirectory);
    expect(await store.getInstalledSkillDirectories()).toEqual([writerDirectory, reviewerDirectory]);
    expect(await store.getAutoUseSkillDirectory()).toBe(writerDirectory);

    await store.uninstallSkillDirectory(writerDirectory);
    expect(await store.getInstalledSkillDirectories()).toEqual([reviewerDirectory]);
    expect(await store.getAutoUseSkillDirectory()).toBeUndefined();

    await store.clearInstalledSkills();
    expect(await store.getInstalledSkillDirectories()).toEqual([]);
  });

  it("clears the auto-use skill without removing installed directories", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-auto-use-"));
    const configFilePath = path.join(tempRoot, ".claude-code-provider-switcher", "skills.json");
    const reviewerDirectory = path.join(tempRoot, "reviewer");
    const writerDirectory = path.join(tempRoot, "writer");
    const globalState = new MemoryGlobalState();
    const store = new SkillStore(globalState, configFilePath);

    await store.setInstalledSkillDirectories([reviewerDirectory, writerDirectory]);
    await store.useSkillDirectory(reviewerDirectory);

    expect(await store.getAutoUseSkillDirectory()).toBe(reviewerDirectory);
    expect(await store.getInstalledSkillDirectories()).toEqual([reviewerDirectory, writerDirectory]);

    await store.clearAutoUseSkill();
    expect(await store.getAutoUseSkillDirectory()).toBeUndefined();
    expect(await store.getInstalledSkillDirectories()).toEqual([reviewerDirectory, writerDirectory]);

    // clearAutoUseSkill is idempotent
    await store.clearAutoUseSkill();
    expect(await store.getAutoUseSkillDirectory()).toBeUndefined();
  });

  it("loads skill roots and direct skills from the skill config file", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-skill-config-"));
    const configDirectory = path.join(tempRoot, ".claude-code-provider-switcher");
    const rootSkillDirectory = path.join(tempRoot, ".claude", "skills", "writer");
    const directSkillDirectory = path.join(tempRoot, "external-skill");
    await fs.mkdir(configDirectory, { recursive: true });
    await fs.mkdir(rootSkillDirectory, { recursive: true });
    await fs.mkdir(directSkillDirectory, { recursive: true });
    await fs.writeFile(path.join(rootSkillDirectory, "SKILL.md"), "# Writer\nWrites docs.", "utf8");

    const configPath = path.join(configDirectory, "skills.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        skillRoots: ["../.claude/skills"],
        skills: [{ name: "External Skill", directory: "../external-skill", description: "Configured directly." }],
        installedSkillDirectories: ["../external-skill"],
        groups: [{ id: "docs", name: "Docs", skillDirectories: ["../external-skill"] }]
      }),
      "utf8"
    );

    const configured = await loadConfiguredSkills([configPath]);
    const rootedSkills = await loadClaudeSkillsFromRoots(configured.roots);
    const skills = [...rootedSkills, ...configured.skills].sort((left, right) => left.name.localeCompare(right.name));

    expect(skills.map((skill) => skill.name)).toEqual(["External Skill", "writer"]);
    expect(skills[0].scope).toBe("config");
    expect(skills[1].scope).toBe("config");
    expect(configured.installedSkillDirectories).toEqual([directSkillDirectory]);
    expect(configured.groups).toEqual([{ id: "docs", name: "Docs", skillDirectories: [directSkillDirectory] }]);
  });

  it("creates, renames, edits, and deletes skill groups", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-skill-groups-"));
    const configFilePath = path.join(tempRoot, ".claude-code-provider-switcher", "skills.json");
    const globalState = new MemoryGlobalState();
    const store = new SkillStore(globalState, configFilePath);
    const skillDirectory = path.join(tempRoot, "reviewer");
    const movedSkillDirectory = path.join(tempRoot, "writer");

    const review = await store.createSkillGroup("Review");
    const docs = await store.createSkillGroup("Docs");
    await store.addSkillToGroup(review.id, skillDirectory);
    await store.renameSkillGroup(review.id, "Code Review");
    await store.moveSkillToGroup(review.id, docs.id, skillDirectory);
    await store.addSkillToGroup(docs.id, movedSkillDirectory);
    await store.removeSkillFromGroup(docs.id, movedSkillDirectory);

    expect(await store.getSkillGroups()).toEqual([
      { id: review.id, name: "Code Review", skillDirectories: [] },
      { id: docs.id, name: "Docs", skillDirectories: [skillDirectory] }
    ]);

    await store.deleteSkillGroup(review.id);
    expect((await store.getSkillGroups()).map((group) => group.name)).toEqual(["Docs"]);
  });

  it("parses GitHub skill repository URLs", () => {
    expect(parseGithubSkillUrl("https://github.com/acme/reviewer-skill")).toEqual({
      owner: "acme",
      repositoryName: "reviewer-skill",
      cloneUrl: "https://github.com/acme/reviewer-skill.git",
      sourceUrl: "https://github.com/acme/reviewer-skill"
    });
    expect(parseGithubSkillUrl("git@github.com:acme/docs-skill.git").cloneUrl).toBe(
      "https://github.com/acme/docs-skill.git"
    );
  });

  it("creates a default skill config shape", () => {
    expect(createDefaultSkillConfig()).toEqual({
      skillRoots: ["~/.claude/skills", "../.claude/skills"],
      skills: [],
      installedSkillDirectories: [],
      groups: []
    });
  });
});
