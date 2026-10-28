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
  /**
   * Serializes all read-modify-write operations on the config file within this
   * process. Without it, concurrent commands (webview refresh, select provider,
   * add provider, ...) race on readConfigFile -> writeConfigFile and the last
   * writer wins, silently dropping providers.
   */
  private configWriteChain: Promise<void> = Promise.resolve();
  private readonly globalState: ProviderStoreStorage["globalState"];
  private readonly secrets: ProviderStoreStorage["secrets"];
  private readonly configFilePath: string;
  private readonly legacyTokenFilePath: string;

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
      await this.saveProviders(createBuiltInPresets());
      return;
    }

    const existingIds = new Set(providers.map((provider) => provider.id));
    const missingPresets = createBuiltInPresets().filter((provider) => !existingIds.has(provider.id));
    // Existing config files are user-editable, including model overrides. Only
    // migrate legacy global-state presets; never reset saved provider choices.
    const combined = [...providers, ...missingPresets];
    const nextProviders = loaded.source === "config" ? combined : migrateBuiltInPresetDefaults(combined);
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

  /**
   * Read-modify-write the provider list atomically (process-wide) so concurrent
   * addProvider/updateProvider/deleteProvider calls cannot drop each other. The
   * mutate callback receives the freshest in-memory state and returns the new
   * list; the result is persisted while still holding the write lock.
   */
  private async mutateProviders(
    mutate: (providers: ProviderProfile[]) => ProviderProfile[]
  ): Promise<void> {
    await this.runConfigWrite(async () => {
      const loaded = await this.loadProviders();
      const cloned = cloneProviders(mutate(loaded.providers));
      // Persist the in-memory backup first: if the following file write is
      // interrupted, ensureBuiltInPresets can still recover from globalState.
      await this.globalState.update(providersKey, cloned);
      const legacyActiveProviderId = this.globalState.get<string>(activeProviderIdKey);
      await this.updateConfigFile(
        (config) => ({
          ...config,
          providers: cloned,
          activeProviderId: config.activeProviderId ?? legacyActiveProviderId
        }),
        { recoverCorruption: true }
      );
    });
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

    if (!updated) {
      throw new Error("Provider update failed.");
    }

    if (secretChange.kind === "replace") {
      await this.setToken(id, secretChange.token);
    } else if (secretChange.kind === "remove") {
      await this.deleteToken(id);
    }

    return updated;
  }

  public async deleteProvider(id: string): Promise<void> {
    await this.mutateProviders((providers) => providers.filter((provider) => provider.id !== id));
    await this.deleteToken(id);

    const activeProviderId = await this.getActiveProviderId();
    if (activeProviderId === id) {
      await this.setActiveProviderId(undefined);
    }
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
    });

    await this.deleteLegacyToken(providerId);

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
    let config: ProviderConfigFile;
    try {
      config = await this.readConfigFile();
    } catch (error) {
      if (!(error instanceof InvalidConfigFileError)) {
        throw error;
      }

      // A truncated or half-written config.json must not erase custom
      // providers. Fall back to the globalState backup that every save writes
      // first; ensureBuiltInPresets will then repair the file from it.
      const backup = this.globalState.get<ProviderProfile[]>(providersKey);
      if (Array.isArray(backup)) {
        return { providers: cloneProviders(backup), source: "globalState" };
      }

      // No backup to recover from: keep the original error instead of
      // silently overwriting whatever the user may still be able to repair.
      throw error;
    }

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
    // Persist the in-memory backup FIRST. globalState is the durable fallback
    // if the on-disk write fails or is interrupted.
    await this.globalState.update(providersKey, clonedProviders);
    await this.runConfigWrite(async () => {
      const legacyActiveProviderId = this.globalState.get<string>(activeProviderIdKey);
      await this.updateConfigFile(
        (config) => ({
          ...config,
          providers: clonedProviders,
          activeProviderId: config.activeProviderId ?? legacyActiveProviderId
        }),
        { recoverCorruption: true }
      );
    });
  }

  /**
   * Run a config read-modify-write operation on the process-wide write queue
   * so concurrent callers cannot interleave reads and writes and lose data.
   * Errors are propagated, but the chain is kept regardless of outcome.
   */
  private async runConfigWrite<T>(op: () => Promise<T>): Promise<T> {
    const next = this.configWriteChain.then(op, op);
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
      throw new InvalidConfigFileError("Provider config contains invalid JSON. Fix config.json before saving.");
    }
  }

  private async updateConfigFile(
    update: (config: ProviderConfigFile) => ProviderConfigFile,
    options: { recoverCorruption?: boolean } = {}
  ): Promise<void> {
    let config: ProviderConfigFile;
    try {
      config = await this.readConfigFile();
    } catch (error) {
      if (!options.recoverCorruption || !(error instanceof InvalidConfigFileError)) {
        throw error;
      }

      // Recovery is only requested after loadProviders has confirmed that a
      // globalState backup exists, so starting from an empty file cannot lose
      // the provider list.
      config = { version: 1 };
    }

    await this.writeConfigFile(update(config));
  }

  private async writeConfigFile(config: ProviderConfigFile): Promise<void> {
    const normalized = normalizeConfigFile(config);
    await fs.mkdir(path.dirname(this.configFilePath), { recursive: true });
    const temporaryPath = `${this.configFilePath}.${process.pid}.${createProviderId()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.configFilePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
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

class InvalidConfigFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidConfigFileError";
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

    if (Object.entries(draft).every(([key, value]) => provider[key as keyof ProviderProfile] === value)) {
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
