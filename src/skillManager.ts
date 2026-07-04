import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { activeSkillIdKey, ClaudeSkill, GlobalStateLike } from "./types";

interface SkillManifest {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
}

interface SkillConfigSkill {
  name?: unknown;
  directory?: unknown;
  description?: unknown;
  sourceUrl?: unknown;
}

interface SkillConfigGroup {
  id?: unknown;
  name?: unknown;
  skillDirectories?: unknown;
  skills?: unknown;
}

interface SkillConfig {
  skillRoots?: unknown;
  skills?: unknown;
  installedSkillDirectories?: unknown;
  activeSkillDirectory?: unknown;
  autoUseSkillDirectory?: unknown;
  activeSkillDirectories?: unknown;
  groups?: unknown;
}

interface LoadedSkillConfig {
  roots: Array<{ directory: string; scope: ClaudeSkill["scope"] }>;
  skills: ClaudeSkill[];
  installedSkillDirectories: string[];
  autoUseSkillDirectory?: string;
  groups: ClaudeSkillGroup[];
}

export interface ClaudeSkillGroup {
  id: string;
  name: string;
  skillDirectories: string[];
}

export interface SkillActionTarget {
  skillDirectory: string;
  groupId?: string;
}

export interface SkillGroupActionTarget {
  groupId: string;
}

interface SkillViewState {
  skills: ClaudeSkill[];
  skillsByDirectory: Map<string, ClaudeSkill>;
  installedDirectories: string[];
  installedDirectorySet: Set<string>;
  autoUseDirectory?: string;
  groups: ClaudeSkillGroup[];
}

type SkillTreeNodeKind = "installedRoot" | "allRoot" | "group" | "skill" | "missing" | "empty";

const skillConfigRelativePath = path.join(".claude-code-provider-switcher", "skills.json");
const execFileAsync = promisify(execFile);
const githubZipBranches = ["main", "master"];

export class SkillStore {
  public constructor(
    private readonly globalState: GlobalStateLike,
    private readonly configFilePath = getSkillConfigPath()
  ) {}

  public async getActiveSkillId(): Promise<string | undefined> {
    const skill = await this.getAutoUseSkill();
    return skill?.id;
  }

  public async setActiveSkillId(skillId: string | undefined): Promise<void> {
    if (!skillId) {
      await this.clearInstalledSkills();
      return;
    }

    const skill = (await loadClaudeSkills()).find((candidate) => candidate.id === skillId);
    if (!skill) {
      return;
    }

    await this.useSkillDirectory(skill.directory);
  }

  public async getActiveSkill(): Promise<ClaudeSkill | undefined> {
    return this.getAutoUseSkill();
  }

  public async getAutoUseSkillDirectory(): Promise<string | undefined> {
    const configPath = await ensureSkillConfigFile(this.configFilePath);
    const config = await readSkillConfig(configPath);
    if (config.autoUseSkillDirectory) {
      return config.autoUseSkillDirectory;
    }

    const legacyDirectory = await this.resolveLegacyActiveSkillDirectory();
    if (!legacyDirectory) {
      return undefined;
    }

    await this.useSkillDirectory(legacyDirectory);
    await this.globalState.update(activeSkillIdKey, undefined);
    return legacyDirectory;
  }

  public async getAutoUseSkill(): Promise<ClaudeSkill | undefined> {
    const [directory, skills] = await Promise.all([this.getAutoUseSkillDirectory(), loadClaudeSkills()]);
    if (!directory) {
      return undefined;
    }

    return createSkillMap(skills).get(normalizeDirectoryKey(directory));
  }

  public async setAutoUseSkillDirectory(directory: string | undefined): Promise<void> {
    const normalized = directory?.trim() ? path.resolve(directory) : undefined;
    await updateSkillConfigFile(this.configFilePath, (config) => {
      const nextConfig = { ...config };
      if (normalized) {
        nextConfig.autoUseSkillDirectory = normalized;
        nextConfig.activeSkillDirectory = normalized;
      } else {
        delete nextConfig.autoUseSkillDirectory;
        delete nextConfig.activeSkillDirectory;
      }

      return nextConfig;
    });
  }

  public async useSkillDirectory(directory: string): Promise<void> {
    const key = normalizeDirectoryKey(directory);
    const installed = await this.getInstalledSkillDirectories();
    if (!installed.some((candidate) => normalizeDirectoryKey(candidate) === key)) {
      await this.setInstalledSkillDirectories([...installed, directory]);
    }
    await this.setAutoUseSkillDirectory(directory);
  }

  public async getInstalledSkillDirectories(): Promise<string[]> {
    const configPath = await ensureSkillConfigFile(this.configFilePath);
    const config = await readSkillConfig(configPath);
    if (config.installedSkillDirectories.length > 0) {
      return config.installedSkillDirectories;
    }

    const legacyDirectory = await this.resolveLegacyActiveSkillDirectory();
    if (!legacyDirectory) {
      return [];
    }

    await this.setInstalledSkillDirectories([legacyDirectory]);
    await this.globalState.update(activeSkillIdKey, undefined);
    return [legacyDirectory];
  }

  public async getInstalledSkills(): Promise<ClaudeSkill[]> {
    const [directories, skills] = await Promise.all([this.getInstalledSkillDirectories(), loadClaudeSkills()]);
    const skillsByDirectory = createSkillMap(skills);
    return directories
      .map((directory) => skillsByDirectory.get(normalizeDirectoryKey(directory)))
      .filter((skill): skill is ClaudeSkill => skill !== undefined);
  }

  public async setInstalledSkillDirectories(directories: string[]): Promise<void> {
    await updateSkillConfigFile(this.configFilePath, (config) => {
      const installedSkillDirectories = uniqueDirectories(directories);
      const installedKeys = new Set(installedSkillDirectories.map(normalizeDirectoryKey));
      const autoUseSkillDirectory = readOptionalDirectory(
        config.autoUseSkillDirectory ?? config.activeSkillDirectory,
        path.dirname(this.configFilePath)
      );
      const nextConfig = {
        ...config,
        installedSkillDirectories
      };
      if (autoUseSkillDirectory && !installedKeys.has(normalizeDirectoryKey(autoUseSkillDirectory))) {
        delete nextConfig.autoUseSkillDirectory;
        delete nextConfig.activeSkillDirectory;
      }

      return nextConfig;
    });
  }

  public async installSkillDirectory(directory: string): Promise<void> {
    const installed = await this.getInstalledSkillDirectories();
    const key = normalizeDirectoryKey(directory);
    if (installed.some((candidate) => normalizeDirectoryKey(candidate) === key)) {
      return;
    }

    await this.setInstalledSkillDirectories([...installed, directory]);
  }

  public async uninstallSkillDirectory(directory: string): Promise<void> {
    const key = normalizeDirectoryKey(directory);
    const installed = (await this.getInstalledSkillDirectories()).filter(
      (candidate) => normalizeDirectoryKey(candidate) !== key
    );
    await this.setInstalledSkillDirectories(installed);
  }

  public async clearInstalledSkills(): Promise<void> {
    await this.setInstalledSkillDirectories([]);
    await this.setAutoUseSkillDirectory(undefined);
    await this.globalState.update(activeSkillIdKey, undefined);
  }

  /**
   * Clears only the auto-use (active) skill, leaving installed background skills
   * intact. This is the "cancel the active skill" operation: new sessions will
   * no longer auto-apply it, but it still loads as a slash command if installed.
   */
  public async clearAutoUseSkill(): Promise<void> {
    await this.setAutoUseSkillDirectory(undefined);
    await this.globalState.update(activeSkillIdKey, undefined);
  }

  public async getSkillGroups(): Promise<ClaudeSkillGroup[]> {
    return (await readSkillConfig(await ensureSkillConfigFile(this.configFilePath))).groups;
  }

  public async createSkillGroup(name: string): Promise<ClaudeSkillGroup> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Skill group name is required.");
    }

    let created: ClaudeSkillGroup | undefined;
    await updateSkillConfigFile(this.configFilePath, (config) => {
      const groups = readConfigGroups(config.groups, path.dirname(this.configFilePath));
      const existingIds = new Set(groups.map((group) => group.id));
      created = {
        id: createSkillGroupId(trimmedName, existingIds),
        name: trimmedName,
        skillDirectories: []
      };
      return { ...config, groups: [...groups, created] };
    });

    if (!created) {
      throw new Error("Skill group could not be created.");
    }

    return created;
  }

  public async renameSkillGroup(groupId: string, name: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Skill group name is required.");
    }

    await updateSkillConfigFile(this.configFilePath, (config) => ({
      ...config,
      groups: readConfigGroups(config.groups, path.dirname(this.configFilePath)).map((group) =>
        group.id === groupId ? { ...group, name: trimmedName } : group
      )
    }));
  }

  public async deleteSkillGroup(groupId: string): Promise<void> {
    await updateSkillConfigFile(this.configFilePath, (config) => ({
      ...config,
      groups: readConfigGroups(config.groups, path.dirname(this.configFilePath)).filter((group) => group.id !== groupId)
    }));
  }

  public async addSkillToGroup(groupId: string, directory: string): Promise<void> {
    await updateSkillConfigFile(this.configFilePath, (config) => ({
      ...config,
      groups: readConfigGroups(config.groups, path.dirname(this.configFilePath)).map((group) =>
        group.id === groupId
          ? { ...group, skillDirectories: uniqueDirectories([...group.skillDirectories, directory]) }
          : group
      )
    }));
  }

  public async removeSkillFromGroup(groupId: string, directory: string): Promise<void> {
    const key = normalizeDirectoryKey(directory);
    await updateSkillConfigFile(this.configFilePath, (config) => ({
      ...config,
      groups: readConfigGroups(config.groups, path.dirname(this.configFilePath)).map((group) =>
        group.id === groupId
          ? {
              ...group,
              skillDirectories: group.skillDirectories.filter((candidate) => normalizeDirectoryKey(candidate) !== key)
            }
          : group
      )
    }));
  }

  public async moveSkillToGroup(fromGroupId: string, toGroupId: string, directory: string): Promise<void> {
    await updateSkillConfigFile(this.configFilePath, (config) => {
      const key = normalizeDirectoryKey(directory);
      const groups = readConfigGroups(config.groups, path.dirname(this.configFilePath)).map((group) => {
        if (group.id === fromGroupId) {
          return {
            ...group,
            skillDirectories: group.skillDirectories.filter((candidate) => normalizeDirectoryKey(candidate) !== key)
          };
        }

        if (group.id === toGroupId) {
          return {
            ...group,
            skillDirectories: uniqueDirectories([...group.skillDirectories, directory])
          };
        }

        return group;
      });

      return { ...config, groups };
    });
  }

  private async resolveLegacyActiveSkillDirectory(): Promise<string | undefined> {
    const legacySkillId = this.globalState.get<string>(activeSkillIdKey);
    if (!legacySkillId) {
      return undefined;
    }

    const skills = await loadClaudeSkills();
    const skill = skills.find((candidate) => candidate.id === legacySkillId);
    if (skill) {
      return skill.directory;
    }

    const legacyDirectory = directoryFromSkillId(legacySkillId);
    return legacyDirectory && (await directoryExists(legacyDirectory)) ? legacyDirectory : undefined;
  }
}

export class ClaudeSkillProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private readonly changed = new vscode.EventEmitter<SkillTreeItem | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly store: SkillStore) {}

  public refresh(): void {
    this.changed.fire(undefined);
  }

  public getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    const state = await createSkillViewState(this.store);

    if (!element) {
      return [
        SkillTreeItem.installedRoot(state.installedDirectories.length),
        ...state.groups.map((group) => SkillTreeItem.group(group)),
        SkillTreeItem.allRoot(state.skills.length)
      ];
    }

    if (element.kind === "installedRoot") {
      return skillItemsForDirectories(state.installedDirectories, state);
    }

    if (element.kind === "allRoot") {
      return state.skills.length > 0
        ? state.skills.map((skill) =>
            SkillTreeItem.skill(
              skill,
              state.installedDirectorySet.has(normalizeDirectoryKey(skill.directory)),
              isAutoUseSkill(skill.directory, state.autoUseDirectory)
            )
          )
        : [SkillTreeItem.empty("No skills found", "Import from GitHub or add a skill root")];
    }

    if (element.kind === "group" && element.groupId) {
      const group = state.groups.find((candidate) => candidate.id === element.groupId);
      return group && group.skillDirectories.length > 0
        ? skillItemsForDirectories(group.skillDirectories, state, group.id)
        : [SkillTreeItem.empty("Empty group", "Add skills from the group menu")];
    }

    return [];
  }
}

export class SkillTreeItem extends vscode.TreeItem {
  private constructor(
    label: string,
    public readonly kind: SkillTreeNodeKind,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly skillDirectory?: string,
    public readonly groupId?: string
  ) {
    super(label, collapsibleState);
  }

  public static installedRoot(count: number): SkillTreeItem {
    const item = new SkillTreeItem("Installed Skills", "installedRoot", vscode.TreeItemCollapsibleState.Expanded);
    item.description = `${count}`;
    item.tooltip = "Skills that will be loaded into new Claude Code sessions.";
    item.iconPath = new vscode.ThemeIcon("checklist");
    item.contextValue = "claudeSkillInstalledRoot";
    return item;
  }

  public static allRoot(count: number): SkillTreeItem {
    const item = new SkillTreeItem("All Skills", "allRoot", vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${count}`;
    item.tooltip = "All discovered local skills.";
    item.iconPath = new vscode.ThemeIcon("list-tree");
    item.contextValue = "claudeSkillAllRoot";
    return item;
  }

  public static group(group: ClaudeSkillGroup): SkillTreeItem {
    const item = new SkillTreeItem(group.name, "group", vscode.TreeItemCollapsibleState.Collapsed, undefined, group.id);
    item.description = `${group.skillDirectories.length}`;
    item.tooltip = "Skill group";
    item.iconPath = new vscode.ThemeIcon("folder");
    item.contextValue = "claudeSkillGroup";
    return item;
  }

  public static skill(skill: ClaudeSkill, installed: boolean, autoUse: boolean, groupId?: string): SkillTreeItem {
    const item = new SkillTreeItem(
      autoUse ? `$(star-full) ${skill.name}` : installed ? `$(check) ${skill.name}` : skill.name,
      "skill",
      vscode.TreeItemCollapsibleState.None,
      skill.directory,
      groupId
    );
    item.description = autoUse
      ? `${skill.scope} · active`
      : installed
        ? `${skill.scope} · loaded`
        : skill.scope;
    item.tooltip = [
      skill.name,
      skill.description,
      skill.directory,
      autoUse
        ? "Active skill — auto-applied in new Claude Code sessions. Click to deactivate."
        : installed
          ? "Loaded as a background skill in new sessions. Click to make it the active skill."
          : "Click to set as the active skill for new Claude Code sessions."
    ]
      .filter(Boolean)
      .join("\n");
    item.iconPath = new vscode.ThemeIcon(autoUse ? "star-full" : installed ? "pass-filled" : "symbol-misc");
    item.contextValue = `${installed ? "claudeSkillInstalled" : "claudeSkillAvailable"}${groupId ? "Grouped" : ""}`;
    item.command = {
      command: "claudeCodeProviderSwitcher.useSkill",
      title: "Claude Code: Toggle Active Skill",
      arguments: [createSkillActionTarget(skill.directory, groupId)]
    };
    return item;
  }

  public static missingSkill(directory: string, groupId?: string): SkillTreeItem {
    const item = new SkillTreeItem(
      path.basename(directory) || directory,
      "missing",
      vscode.TreeItemCollapsibleState.None,
      directory,
      groupId
    );
    item.description = "missing";
    item.tooltip = directory;
    item.iconPath = new vscode.ThemeIcon("warning");
    item.contextValue = groupId ? "claudeSkillMissingGrouped" : "claudeSkillMissing";
    return item;
  }

  public static empty(label: string, description: string): SkillTreeItem {
    const item = new SkillTreeItem(label, "empty");
    item.description = description;
    item.iconPath = new vscode.ThemeIcon("circle-slash");
    item.contextValue = "claudeSkillEmpty";
    return item;
  }
}

export function createSkillActionTarget(skillDirectory: string, groupId?: string): SkillActionTarget {
  return { skillDirectory, groupId };
}

export function createSkillGroupActionTarget(groupId: string): SkillGroupActionTarget {
  return { groupId };
}

export async function loadClaudeSkills(): Promise<ClaudeSkill[]> {
  const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  const roots: Array<{ directory: string; scope: ClaudeSkill["scope"] }> = [
    { directory: path.join(os.homedir(), ".claude", "skills"), scope: "user" },
    ...workspaceRoots.map((root) => ({ directory: path.join(root, ".claude", "skills"), scope: "workspace" as const }))
  ];

  const configPaths = getSkillConfigPaths(workspaceRoots);
  const configured = await loadConfiguredSkills(configPaths);
  const rooted = await loadClaudeSkillsFromRoots([...roots, ...configured.roots]);
  return dedupeSkills([...rooted, ...configured.skills]);
}

export async function loadClaudeSkillsFromRoots(
  roots: Array<{ directory: string; scope: ClaudeSkill["scope"] }>
): Promise<ClaudeSkill[]> {
  const nested = await Promise.all(roots.map((root) => loadSkillsFromRoot(root.directory, root.scope)));
  return nested.flat().sort((left, right) => left.name.localeCompare(right.name));
}

export function getSkillConfigPath(workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []): string {
  return workspaceRoots[0]
    ? path.join(workspaceRoots[0], skillConfigRelativePath)
    : path.join(os.homedir(), skillConfigRelativePath);
}

export function getDefaultUserSkillRoot(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

export async function ensureSkillConfigFile(filePath = getSkillConfigPath()): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
    return filePath;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await fs.writeFile(filePath, `${JSON.stringify(createDefaultSkillConfig(), null, 2)}\n`, "utf8");
  return filePath;
}

export async function openSkillConfigFile(): Promise<void> {
  const filePath = await ensureSkillConfigFile();
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

export function createDefaultSkillConfig(): SkillConfig {
  return {
    skillRoots: ["~/.claude/skills", "../.claude/skills"],
    skills: [],
    installedSkillDirectories: [],
    groups: []
  };
}

export async function loadConfiguredSkills(configPaths: string[]): Promise<LoadedSkillConfig> {
  const configs = await Promise.all(configPaths.map((configPath) => readSkillConfig(configPath)));
  return configs.reduce(
    (result, config) => ({
      roots: [...result.roots, ...config.roots],
      skills: [...result.skills, ...config.skills],
      installedSkillDirectories: uniqueDirectories([...result.installedSkillDirectories, ...config.installedSkillDirectories]),
      autoUseSkillDirectory: result.autoUseSkillDirectory ?? config.autoUseSkillDirectory,
      groups: mergeSkillGroups(result.groups, config.groups)
    }),
    {
      roots: [] as Array<{ directory: string; scope: ClaudeSkill["scope"] }>,
      skills: [] as ClaudeSkill[],
      installedSkillDirectories: [] as string[],
      autoUseSkillDirectory: undefined as string | undefined,
      groups: [] as ClaudeSkillGroup[]
    }
  );
}

export async function importSkillFromGithubUrl(url: string, destinationRoot = getDefaultUserSkillRoot()): Promise<ClaudeSkill> {
  const parsed = parseGithubSkillUrl(url);
  const destination = await createUniqueSkillDestination(destinationRoot, parsed.repositoryName);
  await fs.mkdir(destinationRoot, { recursive: true });
  await execFileAsync("git", ["clone", "--depth", "1", parsed.cloneUrl, destination], {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 1024 * 1024
  });

  const skill = await loadSkill(destination, "user");
  return skill
    ? { ...skill, sourceUrl: parsed.sourceUrl }
    : {
        id: `user:${destination}`,
        name: parsed.repositoryName,
        directory: destination,
        scope: "user",
        description: undefined,
        sourceUrl: parsed.sourceUrl
      };
}

export async function reinstallSkillFromSource(skill: ClaudeSkill): Promise<ClaudeSkill> {
  if (!skill.sourceUrl) {
    throw new Error("This skill does not have a sourceUrl in skills.json, so it cannot be reinstalled from source.");
  }

  const parsed = parseGithubSkillUrl(skill.sourceUrl);
  const location = findGithubRepositoryLocation(skill.directory, parsed.repositoryName);
  if (!location) {
    throw new Error("Could not locate this skill inside its imported GitHub repository folder.");
  }

  const temporaryDirectory = `${location.repositoryContainer}.reinstall-${Date.now()}`;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
  await downloadAndExtractGithubRepository(parsed, temporaryDirectory);

  const extractedRoot = await findExtractedRepositoryRoot(temporaryDirectory, parsed.repositoryName);
  const refreshedSkillDirectory = path.join(extractedRoot, location.skillRelativePath);
  if (!(await pathExists(path.join(refreshedSkillDirectory, "SKILL.md")))) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("The refreshed repository no longer contains this skill directory.");
  }

  await fs.rm(location.repositoryContainer, { recursive: true, force: true });
  let skillDirectory: string;
  if (location.mode === "container") {
    await fs.rename(temporaryDirectory, location.repositoryContainer);
    skillDirectory = path.join(location.extractedRoot, location.skillRelativePath);
  } else {
    await fs.rename(extractedRoot, location.repositoryContainer);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    skillDirectory = path.join(location.repositoryContainer, location.skillRelativePath);
  }

  const refreshed = await loadSkill(skillDirectory, skill.scope);
  return refreshed
    ? { ...refreshed, sourceUrl: parsed.sourceUrl }
    : {
      ...skill,
      directory: skillDirectory
    };
}

export function parseGithubSkillUrl(value: string): { owner: string; repositoryName: string; cloneUrl: string; sourceUrl: string } {
  const trimmed = value.trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(trimmed);
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(trimmed);
  const match = httpsMatch ?? sshMatch;
  if (!match) {
    throw new Error("Enter a GitHub repository URL, for example https://github.com/owner/skill-repo.");
  }

  const repositoryName = sanitizeFileName(match[2]);
  if (!repositoryName) {
    throw new Error("GitHub repository name could not be read from the URL.");
  }

  return {
    owner: match[1],
    repositoryName,
    cloneUrl: `https://github.com/${match[1]}/${repositoryName}.git`,
    sourceUrl: `https://github.com/${match[1]}/${repositoryName}`
  };
}

async function readSkillConfig(filePath: string): Promise<LoadedSkillConfig> {
  try {
    const config = parseSkillConfig(await fs.readFile(filePath, "utf8"));
    const baseDirectory = path.dirname(filePath);
    const roots = readStringArray(config.skillRoots).map((directory) => ({
      directory: resolveConfiguredPath(directory, baseDirectory),
      scope: "config" as const
    }));
    const skills = readConfigSkills(config.skills, baseDirectory);
    const installedSkillDirectories = uniqueDirectories([
      ...readDirectoryArray(config.installedSkillDirectories, baseDirectory),
      ...readDirectoryArray(config.activeSkillDirectories, baseDirectory)
    ]);
    const autoUseSkillDirectory = readOptionalDirectory(
      config.autoUseSkillDirectory ?? config.activeSkillDirectory,
      baseDirectory
    );
    const groups = readConfigGroups(config.groups, baseDirectory);
    return { roots, skills, installedSkillDirectories, autoUseSkillDirectory, groups };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { roots: [], skills: [], installedSkillDirectories: [], autoUseSkillDirectory: undefined, groups: [] };
    }

    throw error;
  }
}

export function parseSkillConfig(content: string): SkillConfig {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? (parsed as SkillConfig) : {};
  } catch {
    return {};
  }
}

async function updateSkillConfigFile(filePath: string, update: (config: SkillConfig) => SkillConfig): Promise<void> {
  await ensureSkillConfigFile(filePath);
  const current = parseSkillConfig(await fs.readFile(filePath, "utf8"));
  const next = update(current);
  await fs.writeFile(filePath, `${JSON.stringify(normalizeWritableSkillConfig(next, path.dirname(filePath)), null, 2)}\n`, "utf8");
}

function normalizeWritableSkillConfig(config: SkillConfig, baseDirectory: string): SkillConfig {
  return {
    skillRoots: readStringArray(config.skillRoots),
    skills: Array.isArray(config.skills) ? config.skills : [],
    installedSkillDirectories: uniqueDirectories([
      ...readDirectoryArray(config.installedSkillDirectories, baseDirectory),
      ...readDirectoryArray(config.activeSkillDirectories, baseDirectory)
    ]),
    autoUseSkillDirectory: readOptionalDirectory(config.autoUseSkillDirectory ?? config.activeSkillDirectory, baseDirectory),
    activeSkillDirectory: readOptionalDirectory(config.autoUseSkillDirectory ?? config.activeSkillDirectory, baseDirectory),
    groups: readConfigGroups(config.groups, baseDirectory).map((group) => ({
      id: group.id,
      name: group.name,
      skillDirectories: uniqueDirectories(group.skillDirectories)
    }))
  };
}

function readConfigSkills(value: unknown, baseDirectory: string): ClaudeSkill[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): ClaudeSkill | undefined => {
      const record = typeof entry === "object" && entry !== null ? (entry as SkillConfigSkill) : undefined;
      const directory = readString(record?.directory);
      if (!record || !directory) {
        return undefined;
      }

      const resolvedDirectory = resolveConfiguredPath(directory, baseDirectory);
      const name = readString(record.name) ?? path.basename(resolvedDirectory);
      return {
        id: `config:${resolvedDirectory}`,
        name,
        directory: resolvedDirectory,
        scope: "config",
        description: readString(record.description),
        sourceUrl: readString(record.sourceUrl)
      };
    })
    .filter((skill): skill is ClaudeSkill => skill !== undefined);
}

function readConfigGroups(value: unknown, baseDirectory: string): ClaudeSkillGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const groups = value
    .map((entry): ClaudeSkillGroup | undefined => {
      const record = typeof entry === "object" && entry !== null ? (entry as SkillConfigGroup) : undefined;
      const name = readString(record?.name);
      if (!record || !name) {
        return undefined;
      }

      const fallbackId = createSkillGroupId(name, new Set());
      return {
        id: readString(record.id) ?? fallbackId,
        name,
        skillDirectories: uniqueDirectories([
          ...readDirectoryArray(record.skillDirectories, baseDirectory),
          ...readDirectoryArray(record.skills, baseDirectory)
        ])
      };
    })
    .filter((group): group is ClaudeSkillGroup => group !== undefined);

  return dedupeGroups(groups);
}

function getSkillConfigPaths(workspaceRoots: string[]): string[] {
  return [
    path.join(os.homedir(), skillConfigRelativePath),
    ...workspaceRoots.map((root) => path.join(root, skillConfigRelativePath))
  ];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function readDirectoryArray(value: unknown, baseDirectory: string): string[] {
  return readStringArray(value).map((directory) => resolveConfiguredPath(directory, baseDirectory));
}

function readOptionalDirectory(value: unknown, baseDirectory: string): string | undefined {
  const directory = readString(value);
  return directory ? resolveConfiguredPath(directory, baseDirectory) : undefined;
}

function resolveConfiguredPath(value: string, baseDirectory: string): string {
  const expanded =
    value.startsWith("~/") || value.startsWith("~\\") || value === "~" ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(baseDirectory, expanded);
}

function dedupeSkills(skills: ClaudeSkill[]): ClaudeSkill[] {
  const seen = new Set<string>();
  return skills
    .filter((skill) => {
      const key = normalizeDirectoryKey(skill.directory);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function dedupeGroups(groups: ClaudeSkillGroup[]): ClaudeSkillGroup[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    if (seen.has(group.id)) {
      return false;
    }

    seen.add(group.id);
    return true;
  });
}

function mergeSkillGroups(left: ClaudeSkillGroup[], right: ClaudeSkillGroup[]): ClaudeSkillGroup[] {
  return dedupeGroups([...left, ...right]);
}

function uniqueDirectories(directories: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const directory of directories) {
    const normalized = path.resolve(directory);
    const key = normalizeDirectoryKey(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function normalizeDirectoryKey(directory: string): string {
  return path.normalize(directory).toLowerCase();
}

async function loadSkillsFromRoot(root: string, scope: ClaudeSkill["scope"]): Promise<ClaudeSkill[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => loadSkill(path.join(root, entry.name), scope))
    );
    return skills.filter((skill): skill is ClaudeSkill => skill !== undefined);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

async function loadSkill(directory: string, scope: ClaudeSkill["scope"]): Promise<ClaudeSkill | undefined> {
  const manifest = await readSkillManifest(directory);
  const directoryName = path.basename(directory);
  const name = readString(manifest?.displayName) ?? readString(manifest?.name) ?? directoryName;
  const description = readString(manifest?.description) ?? (await readMarkdownDescription(directory));

  return {
    id: `${scope}:${directory}`,
    name,
    directory,
    scope,
    description
  };
}

async function readSkillManifest(directory: string): Promise<SkillManifest | undefined> {
  const candidates = [
    path.join(directory, "plugin.json"),
    path.join(directory, ".claude-plugin", "plugin.json"),
    path.join(directory, "skill.json")
  ];

  for (const candidate of candidates) {
    const manifest = await readJson(candidate);
    if (manifest) {
      return manifest;
    }
  }

  return undefined;
}

async function readJson(filePath: string): Promise<SkillManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as SkillManifest) : undefined;
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    return undefined;
  }
}

async function readMarkdownDescription(directory: string): Promise<string | undefined> {
  const candidates = [path.join(directory, "SKILL.md"), path.join(directory, "README.md")];
  for (const candidate of candidates) {
    try {
      const firstLine = (await fs.readFile(candidate, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.replace(/^#+\s*/, "").trim())
        .find(Boolean);
      if (firstLine) {
        return firstLine;
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  return undefined;
}

/**
 * Reads the full skill instructions (SKILL.md, falling back to README.md) so
 * they can be injected as a system prompt for a workflow step's model.
 */
export async function readSkillInstructions(directory: string): Promise<string | undefined> {
  const candidates = [path.join(directory, "SKILL.md"), path.join(directory, "README.md")];
  for (const candidate of candidates) {
    try {
      const content = (await fs.readFile(candidate, "utf8")).trim();
      if (content) {
        return content;
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  return undefined;
}

async function createSkillViewState(store: SkillStore): Promise<SkillViewState> {
  const [skills, installedDirectories, autoUseDirectory, groups] = await Promise.all([
    loadClaudeSkills(),
    store.getInstalledSkillDirectories(),
    store.getAutoUseSkillDirectory(),
    store.getSkillGroups()
  ]);
  const skillsByDirectory = createSkillMap(skills);
  const installedDirectorySet = new Set(installedDirectories.map(normalizeDirectoryKey));
  return { skills, skillsByDirectory, installedDirectories, installedDirectorySet, autoUseDirectory, groups };
}

function skillItemsForDirectories(directories: string[], state: SkillViewState, groupId?: string): SkillTreeItem[] {
  if (directories.length === 0) {
    return [SkillTreeItem.empty("No installed skills", "Install skills from All Skills")];
  }

  return directories.map((directory) => {
    const skill = state.skillsByDirectory.get(normalizeDirectoryKey(directory));
    if (!skill) {
      return SkillTreeItem.missingSkill(directory, groupId);
    }

    return SkillTreeItem.skill(
      skill,
      state.installedDirectorySet.has(normalizeDirectoryKey(skill.directory)),
      isAutoUseSkill(skill.directory, state.autoUseDirectory),
      groupId
    );
  });
}

function isAutoUseSkill(directory: string, autoUseDirectory: string | undefined): boolean {
  return Boolean(autoUseDirectory && normalizeDirectoryKey(directory) === normalizeDirectoryKey(autoUseDirectory));
}

function createSkillMap(skills: ClaudeSkill[]): Map<string, ClaudeSkill> {
  return new Map(skills.map((skill) => [normalizeDirectoryKey(skill.directory), skill]));
}

function createSkillGroupId(name: string, existingIds: Set<string>): string {
  const base =
    sanitizeFileName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group";
  let candidate = base;
  let index = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  return candidate;
}

function directoryFromSkillId(skillId: string): string | undefined {
  const separatorIndex = skillId.indexOf(":");
  if (separatorIndex === -1) {
    return undefined;
  }

  const directory = skillId.slice(separatorIndex + 1);
  return directory.trim() ? directory : undefined;
}

async function createUniqueSkillDestination(destinationRoot: string, repositoryName: string): Promise<string> {
  let destination = path.join(destinationRoot, repositoryName);
  let index = 2;
  while (await pathExists(destination)) {
    destination = path.join(destinationRoot, `${repositoryName}-${index}`);
    index += 1;
  }

  return destination;
}

interface GithubRepositoryLocation {
  repositoryContainer: string;
  extractedRoot: string;
  skillRelativePath: string;
  mode: "container" | "root";
}

function findGithubRepositoryLocation(skillDirectory: string, repositoryName: string): GithubRepositoryLocation | undefined {
  const resolvedDirectory = path.resolve(skillDirectory);
  const repositoryNameLower = repositoryName.toLowerCase();
  let current = resolvedDirectory;

  while (true) {
    const currentName = path.basename(current).toLowerCase();
    if (currentName.startsWith(`${repositoryNameLower}-`)) {
      return {
        repositoryContainer: path.dirname(current),
        extractedRoot: current,
        skillRelativePath: path.relative(current, resolvedDirectory),
        mode: "container"
      };
    }

    if (currentName === repositoryNameLower) {
      return {
        repositoryContainer: current,
        extractedRoot: current,
        skillRelativePath: path.relative(current, resolvedDirectory),
        mode: "root"
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

async function downloadAndExtractGithubRepository(
  repository: { owner: string; repositoryName: string },
  destinationDirectory: string
): Promise<void> {
  await fs.rm(destinationDirectory, { recursive: true, force: true });
  await fs.mkdir(destinationDirectory, { recursive: true });
  const temporaryZip = path.join(os.tmpdir(), `ccps-${repository.repositoryName}-${Date.now()}.zip`);
  let lastError: unknown;

  try {
    for (const branch of githubZipBranches) {
      const zipUrl = `https://codeload.github.com/${repository.owner}/${repository.repositoryName}/zip/refs/heads/${branch}`;
      try {
        await execFileAsync(process.platform === "win32" ? "curl.exe" : "curl", [
          "-fL",
          zipUrl,
          "-o",
          temporaryZip,
          "--connect-timeout",
          "20",
          "--max-time",
          "120"
        ]);
        await extractZip(temporaryZip, destinationDirectory);
        return;
      } catch (error) {
        lastError = error;
        await fs.rm(temporaryZip, { force: true });
        await fs.rm(destinationDirectory, { recursive: true, force: true });
        await fs.mkdir(destinationDirectory, { recursive: true });
      }
    }
  } finally {
    await fs.rm(temporaryZip, { force: true });
  }

  throw new Error(`Could not download GitHub repository ZIP for ${repository.owner}/${repository.repositoryName}: ${String(lastError)}`);
}

async function extractZip(zipPath: string, destinationDirectory: string): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      zipPath,
      destinationDirectory
    ]);
    return;
  }

  await execFileAsync("unzip", ["-q", zipPath, "-d", destinationDirectory]);
}

async function findExtractedRepositoryRoot(destinationDirectory: string, repositoryName: string): Promise<string> {
  const entries = await fs.readdir(destinationDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(destinationDirectory, entry.name));
  const repositoryNameLower = repositoryName.toLowerCase();
  const candidate = directories.find((directory) => path.basename(directory).toLowerCase().startsWith(`${repositoryNameLower}-`));
  if (!candidate) {
    throw new Error("Downloaded repository ZIP did not contain the expected root folder.");
  }

  return candidate;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

function sanitizeFileName(value: string): string {
  return Array.from(value.trim().replace(/\.git$/i, ""))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character;
    })
    .join("")
    .replace(/\.+$/g, "")
    .trim();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
