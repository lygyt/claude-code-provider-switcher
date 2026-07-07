import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  activeProviderIdKey,
  extensionPrefix,
  ProviderAuthType,
  ProviderProfile,
  ProviderProfileDraft,
  providersKey,
  ProviderStoreStorage,
  SecretChange
} from "./types";
import { createBuiltInPresets, presetDrafts } from "./providerPresets";
import { createProviderId, nowIso, normalizeOptionalText } from "./utils";

interface ProviderConfigFile {
  version: 1;
  providers?: ProviderProfile[];
  activeProviderId?: string;
  tokens?: Record<string, string>;
}

interface LoadedProviders {
  providers: ProviderProfile[];
  source: "config" | "globalState" | "empty";
}

const configFileName = "config.json";
const legacyTokenFileName = "tokens.json";

export function getDefaultProviderConfigFilePath(): string {
  return path.join(os.homedir(), ".claude-code-provider-switcher", configFileName);
}

export function getDefaultLegacyTokenFilePath(): string {
  return path.join(os.homedir(), ".claude-code-provider-switcher", legacyTokenFileName);
}

export class ProviderStore {
  private readonly globalState: ProviderStoreStorage["globalState"];
  private readonly secrets: ProviderStoreStorage["secrets"];
  private readonly configFilePath: string;
  private readonly legacyTokenFilePath: string;
  /**
   * Serializes all read-modify-write operations on the config file within this
   * process. Without it, concurrent commands (webview refresh, select provider,
   * add provider, ...) race on readConfigFile -> writeConfigFile and the last
   * writer wins, silently dropping providers. See the "providers disappear
   * after a while" bug.
   */
  private configWriteChain: Promise<void> = Promise.resolve();

  public constructor(storage: ProviderStoreStorage) {
    this.globalState = storage.globalState;
    this.secrets = storage.secrets;
    this.configFilePath = storage.configFilePath ?? getDefaultProviderConfigFilePath();
    this.legacyTokenFilePath = storage.legacyTokenFilePath ?? getDefaultLegacyTokenFilePath();
  }

  public getConfigFilePath(): string {
    return this.configFilePath;
  }

  public async ensureBuiltInPresets(): Promise<void> {
    const loaded = await this.loadProviders();
    const providers = loaded.providers;
    if (providers.length === 0) {
      // Only reached when BOTH the config file and globalState have no providers
      // (genuine first run). On corruption, loadProviders falls back to the
      // globalState backup that every save writes first — so a half-written
      // config file can never erase custom providers here.
      await this.saveProviders(createBuiltInPresets());
      return;
    }

    const existingIds = new Set(providers.map((provider) => provider.id));
    const missingPresets = createBuiltInPresets().filter((provider) => !existingIds.has(provider.id));
    const nextProviders = migrateBuiltInPresetDefaults([...providers, ...missingPresets]);
    if (loaded.source !== "config" || missingPresets.length > 0 || providersChanged(providers, nextProviders)) {
      await this.saveProviders(nextProviders);
    }
  }

  public async resetBuiltInPresets(): Promise<ProviderProfile[]> {
    const existing = await this.getProviders();
    const presetIds = new Set(createBuiltInPresets().map((provider) => provider.id));
    const customProviders = existing.filter((provider) => !presetIds.has(provider.id));
    const providers = [...createBuiltInPresets(), ...customProviders];
    await this.saveProviders(providers);
    return providers;
  }

  public async getProviders(): Promise<ProviderProfile[]> {
    return (await this.loadProviders()).providers;
  }

  public async addProvider(draft: ProviderProfileDraft, token?: string): Promise<ProviderProfile> {
    const timestamp = nowIso();
    const provider: ProviderProfile = {
      id: createProviderId(),
      ...sanitizeDraft(draft),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.mutateProviders((providers) => [...providers, provider]);

    if (token?.trim()) {
      await this.setToken(provider.id, token.trim());
    }

    return provider;
  }

  public async updateProvider(id: string, draft: ProviderProfileDraft, secretChange: SecretChange): Promise<ProviderProfile> {
    let updated: ProviderProfile | undefined;
    await this.mutateProviders((providers) => {
      const index = providers.findIndex((provider) => provider.id === id);
      if (index === -1) {
        throw new Error("Provider no longer exists.");
      }

      const existing = providers[index];
      updated = {
        ...existing,
        ...sanitizeDraft(draft),
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso()
      };

      const next = [...providers];
      next[index] = updated;
      return next;
    });

    if (secretChange.kind === "replace") {
      await this.setToken(id, secretChange.token);
    } else if (secretChange.kind === "remove") {
      await this.deleteToken(id);
    }

    return updated!;
  }

  public async deleteProvider(id: string): Promise<void> {
    await this.mutateProviders((providers) => providers.filter((provider) => provider.id !== id));
    await this.deleteToken(id);

    const activeProviderId = await this.getActiveProviderId();
    if (activeProviderId === id) {
      await this.setActiveProviderId(undefined);
    }
  }

  /**
   * Read-modify-write the provider list atomically (process-wide) so concurrent
   * addProvider/updateProvider/deleteProvider calls cannot drop each other. The
   * mutate callback receives the freshest in-memory state and returns the new
   * list; saveProviders persists it under the lock.
   */
  private async mutateProviders(
    mutate: (providers: ProviderProfile[]) => ProviderProfile[]
  ): Promise<void> {
    await this.runConfigWrite(async () => {
      const loaded = await this.loadProviders();
      const next = mutate(loaded.providers);
      const cloned = cloneProviders(next);
      await this.globalState.update(providersKey, cloned);
      const legacyActiveProviderId = this.globalState.get<string>(activeProviderIdKey);
      await this.updateConfigFile((config) => ({
        ...config,
        providers: cloned,
        activeProviderId: config.activeProviderId ?? legacyActiveProviderId
      }));
    });
  }

  public async getActiveProviderId(): Promise<string | undefined> {
    const config = await this.readConfigFile();
    if (config.activeProviderId) {
      return config.activeProviderId;
    }

    return this.globalState.get<string>(activeProviderIdKey);
  }

  public async setActiveProviderId(id: string | undefined): Promise<void> {
    await this.runConfigWrite(async () => {
      await this.updateConfigFile((config) => {
        if (id?.trim()) {
          return { ...config, activeProviderId: id.trim() };
        }

        const nextConfig = { ...config };
        delete nextConfig.activeProviderId;
        return nextConfig;
      });
    });
    await this.globalState.update(activeProviderIdKey, id);
  }

  public async getActiveProvider(): Promise<ProviderProfile | undefined> {
    const activeProviderId = await this.getActiveProviderId();
    if (!activeProviderId) {
      return undefined;
    }

    return (await this.getProviders()).find((provider) => provider.id === activeProviderId);
  }

  public async getToken(providerId: string): Promise<string | undefined> {
    const config = await this.readConfigFile();
    const configToken = config.tokens?.[providerId];
    if (configToken?.trim()) {
      return configToken;
    }

    const legacyTokens = await this.readLegacyTokenFile();
    const legacyToken = legacyTokens[providerId];
    if (legacyToken?.trim()) {
      await this.setToken(providerId, legacyToken.trim());
      return legacyToken.trim();
    }

    const secret = await this.secrets.get(secretKey(providerId));
    if (secret?.trim()) {
      await this.setToken(providerId, secret.trim());
      return secret.trim();
    }

    return undefined;
  }

  public async setToken(providerId: string, token: string): Promise<void> {
    await this.runConfigWrite(async () => {
      await this.updateConfigFile((config) => ({
        ...config,
        tokens: {
          ...(config.tokens ?? {}),
          [providerId]: token
        }
      }));
    });

    try {
      await this.secrets.store(secretKey(providerId), token);
    } catch {
      // The file config is the source of truth; SecretStorage sync is best-effort migration support.
    }
  }

  public async deleteToken(providerId: string): Promise<void> {
    await this.runConfigWrite(async () => {
      await this.updateConfigFile((config) => {
        const tokens = { ...(config.tokens ?? {}) };
        delete tokens[providerId];
        return { ...config, tokens };
      });
      await this.deleteLegacyToken(providerId);
    });

    try {
      await this.secrets.delete(secretKey(providerId));
    } catch {
      // Ignore SecretStorage failures after the file config has been updated.
    }
  }

  public async hasToken(providerId: string): Promise<boolean> {
    return Boolean((await this.getToken(providerId))?.trim());
  }

  private async loadProviders(): Promise<LoadedProviders> {
    const config = await this.readConfigFile();
    if (Array.isArray(config.providers)) {
      return { providers: cloneProviders(config.providers), source: "config" };
    }

    const value = this.globalState.get<ProviderProfile[]>(providersKey);
    if (Array.isArray(value)) {
      return { providers: cloneProviders(value), source: "globalState" };
    }

    return { providers: [], source: "empty" };
  }

  private async saveProviders(providers: ProviderProfile[]): Promise<void> {
    const clonedProviders = cloneProviders(providers);
    // Persist the in-memory backup FIRST. globalState is our durable fallback
    // if the on-disk file write fails or is interrupted — ensureBuiltInPresets
    // falls back to it instead of nuking custom providers.
    await this.globalState.update(providersKey, clonedProviders);
    await this.runConfigWrite(async () => {
      const legacyActiveProviderId = this.globalState.get<string>(activeProviderIdKey);
      await this.updateConfigFile((config) => ({
        ...config,
        providers: clonedProviders,
        activeProviderId: config.activeProviderId ?? legacyActiveProviderId
      }));
    });
  }

  /**
   * Run a config read-modify-write op on the process-wide write queue so
   * concurrent callers cannot interleave reads and writes and lose data.
   * Errors are propagated, but the chain is kept regardless of outcome.
   */
  private async runConfigWrite<T>(op: () => Promise<T>): Promise<T> {
    const next = this.configWriteChain.then(op, op);
    // Reset the chain to a resolved promise once settled, so a transient
    // failure can't poison every subsequent write.
    this.configWriteChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async readConfigFile(): Promise<ProviderConfigFile> {
    let content: string;
    try {
      content = await fs.readFile(this.configFilePath, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return { version: 1 };
      }
      throw error;
    }

    const stripped = stripJsonBom(content).trim();
    if (!stripped) {
      return { version: 1 };
    }

    try {
      return normalizeConfigFile(JSON.parse(stripped));
    } catch {
      // Corrupted JSON — treat the same as missing so the extension can recover
      return { version: 1 };
    }
  }

  private async updateConfigFile(update: (config: ProviderConfigFile) => ProviderConfigFile): Promise<void> {
    const config = await this.readConfigFile();
    await this.writeConfigFile(update(config));
  }

  /**
   * Atomically replace the config file: write to a sibling temp file then rename
   * onto the final path. A direct fs.writeFile can be interrupted mid-write
   * (concurrent watcher, antivirus, another window), leaving a truncated config
   * that loses every provider on the next load. Rename is atomic on the same
   * volume, and the temp file lives in the same directory as the target.
   */
  private async writeConfigFile(config: ProviderConfigFile): Promise<void> {
    const normalized = normalizeConfigFile(config);
    const directory = path.dirname(this.configFilePath);
    await fs.mkdir(directory, { recursive: true });
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    const tempFilePath = `${this.configFilePath}.${process.pid}.tmp`;
    await fs.writeFile(tempFilePath, payload, "utf8");
    try {
      await fs.rename(tempFilePath, this.configFilePath);
    } catch (error) {
      await fs.unlink(tempFilePath).catch(() => undefined);
      throw error;
    }
  }

  private async readLegacyTokenFile(): Promise<Record<string, string>> {
    let content: string;
    try {
      content = await fs.readFile(this.legacyTokenFilePath, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return {};
      }
      throw error;
    }

    const stripped = stripJsonBom(content).trim();
    if (!stripped) {
      return {};
    }

    try {
      return readTokenRecord(JSON.parse(stripped));
    } catch {
      return {};
    }
  }

  private async deleteLegacyToken(providerId: string): Promise<void> {
    const tokens = await this.readLegacyTokenFile();
    if (!(providerId in tokens)) {
      return;
    }

    delete tokens[providerId];
    await fs.mkdir(path.dirname(this.legacyTokenFilePath), { recursive: true });
    await fs.writeFile(this.legacyTokenFilePath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  }
}

export function secretKey(providerId: string): string {
  return `${extensionPrefix}.token.${providerId}`;
}

function sanitizeDraft(draft: ProviderProfileDraft): ProviderProfileDraft {
  return {
    name: draft.name.trim(),
    authType: draft.authType,
    baseUrl: normalizeOptionalText(draft.baseUrl),
    model: normalizeOptionalText(draft.model),
    opusModel: normalizeOptionalText(draft.opusModel),
    sonnetModel: normalizeOptionalText(draft.sonnetModel),
    haikuModel: normalizeOptionalText(draft.haikuModel),
    subagentModel: normalizeOptionalText(draft.subagentModel),
    effortLevel: draft.effortLevel,
    chatBaseUrl: normalizeOptionalText(draft.chatBaseUrl),
    chatModel: normalizeOptionalText(draft.chatModel)
  };
}

function migrateBuiltInPresetDefaults(providers: ProviderProfile[]): ProviderProfile[] {
  let changed = false;
  const nextProviders = providers.map((provider) => {
    const draft = presetDrafts[provider.id as keyof typeof presetDrafts];
    if (!draft || provider.name.trim().toLowerCase() !== draft.name.trim().toLowerCase()) {
      return provider;
    }

    changed = true;
    return {
      ...provider,
      ...draft,
      id: provider.id,
      createdAt: provider.createdAt,
      updatedAt: nowIso()
    };
  });

  return changed ? nextProviders : providers;
}

function providersChanged(left: ProviderProfile[], right: ProviderProfile[]): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function cloneProviders(providers: ProviderProfile[]): ProviderProfile[] {
  return providers.map((provider) => ({ ...provider }));
}

function normalizeConfigFile(value: unknown): ProviderConfigFile {
  const record = readRecord(value);
  if (!record) {
    return { version: 1 };
  }

  const config: ProviderConfigFile = { version: 1 };
  const providers = readProviderArray(record.providers);
  if (providers) {
    config.providers = providers;
  }

  if (typeof record.activeProviderId === "string" && record.activeProviderId.trim()) {
    config.activeProviderId = record.activeProviderId.trim();
  }

  const tokens = readTokenRecord(record.tokens);
  if (Object.keys(tokens).length > 0 || "tokens" in record) {
    config.tokens = tokens;
  }

  return config;
}

function readProviderArray(value: unknown): ProviderProfile[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map(readProvider).filter((provider): provider is ProviderProfile => provider !== undefined);
}

function readProvider(value: unknown): ProviderProfile | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const id = readTrimmedString(record.id);
  const name = readTrimmedString(record.name);
  const authType = readAuthType(record.authType);
  if (!id || !name || !authType) {
    return undefined;
  }

  return {
    id,
    name,
    authType,
    baseUrl: readOptionalString(record.baseUrl),
    model: readOptionalString(record.model),
    opusModel: readOptionalString(record.opusModel),
    sonnetModel: readOptionalString(record.sonnetModel),
    haikuModel: readOptionalString(record.haikuModel),
    subagentModel: readOptionalString(record.subagentModel),
    effortLevel: readEffortLevel(record.effortLevel),
    chatBaseUrl: readOptionalString(record.chatBaseUrl),
    chatModel: readOptionalString(record.chatModel),
    createdAt: readTrimmedString(record.createdAt) ?? nowIso(),
    updatedAt: readTrimmedString(record.updatedAt) ?? nowIso()
  };
}

function readTokenRecord(value: unknown): Record<string, string> {
  const record = readRecord(value);
  if (!record) {
    return {};
  }

  const tokens: Record<string, string> = {};
  for (const [key, token] of Object.entries(record)) {
    if (typeof token === "string" && token.trim()) {
      tokens[key] = token.trim();
    }
  }

  return tokens;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptionalText(value) : undefined;
}

function readAuthType(value: unknown): ProviderAuthType | undefined {
  if (value === "anthropic-auth-token" || value === "anthropic-api-key" || value === "oauth") {
    return value;
  }

  return undefined;
}

function readEffortLevel(value: unknown): ProviderProfile["effortLevel"] | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }

  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function stripJsonBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
