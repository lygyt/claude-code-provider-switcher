import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { presetIds } from "../src/providerPresets";
import { ProviderStore, secretKey } from "../src/providerStore";
import { activeProviderIdKey, GlobalStateLike, providersKey, SecretStorageLike } from "../src/types";

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

class MemorySecrets implements SecretStorageLike {
  public readonly values = new Map<string, string>();

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  public async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

async function createStore(): Promise<{
  store: ProviderStore;
  globalState: MemoryGlobalState;
  secrets: MemorySecrets;
  configFilePath: string;
  legacyTokenFilePath: string;
}> {
  const globalState = new MemoryGlobalState();
  const secrets = new MemorySecrets();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ccps-store-"));
  const configFilePath = path.join(directory, "config.json");
  const legacyTokenFilePath = path.join(directory, "tokens.json");
  return {
    store: new ProviderStore({ globalState, secrets, configFilePath, legacyTokenFilePath }),
    globalState,
    secrets,
    configFilePath,
    legacyTokenFilePath
  };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

describe("ProviderStore", () => {
  it("adds a provider and stores the token in the config file", async () => {
    const { store, configFilePath, secrets } = await createStore();
    const provider = await store.addProvider(
      {
        name: "DeepSeek",
        authType: "anthropic-auth-token",
        baseUrl: "https://api.deepseek.com/anthropic"
      },
      "secret-token"
    );

    const config = await readJsonFile<{ providers: unknown[]; tokens: Record<string, string> }>(configFilePath);
    expect(config.providers).toHaveLength(1);
    expect(JSON.stringify(config.providers)).not.toContain("secret-token");
    expect(config.tokens[provider.id]).toBe("secret-token");
    expect(await secrets.get(secretKey(provider.id))).toBe("secret-token");
  });

  it("updates a provider while keeping its id unchanged", async () => {
    const { store } = await createStore();
    const provider = await store.addProvider({ name: "Original", authType: "oauth" });

    const updated = await store.updateProvider(
      provider.id,
      { name: "Updated", authType: "oauth", model: "claude-sonnet" },
      { kind: "keep" }
    );

    expect(updated.id).toBe(provider.id);
    expect(updated.name).toBe("Updated");
    expect(updated.model).toBe("claude-sonnet");
  });

  it("deletes a provider and its secret", async () => {
    const { store, secrets, configFilePath } = await createStore();
    const provider = await store.addProvider({ name: "Token Provider", authType: "anthropic-api-key" }, "token");

    await store.deleteProvider(provider.id);

    const config = await readJsonFile<{ tokens: Record<string, string> }>(configFilePath);
    expect(await store.getProviders()).toHaveLength(0);
    expect(config.tokens[provider.id]).toBeUndefined();
    expect(await secrets.get(secretKey(provider.id))).toBeUndefined();
  });

  it("stores and reads a token for an existing provider", async () => {
    const { store } = await createStore();
    const provider = await store.addProvider({ name: "DeepSeek", authType: "anthropic-auth-token" });

    await store.setToken(provider.id, "stored-token");

    expect(await store.getToken(provider.id)).toBe("stored-token");
  });

  it("sets and clears the active provider id", async () => {
    const { store, globalState, configFilePath } = await createStore();
    const provider = await store.addProvider({ name: "Active", authType: "oauth" });

    await store.setActiveProviderId(provider.id);
    expect(await store.getActiveProviderId()).toBe(provider.id);
    expect((await readJsonFile<{ activeProviderId: string }>(configFilePath)).activeProviderId).toBe(provider.id);

    await store.deleteProvider(provider.id);
    expect(await store.getActiveProviderId()).toBeUndefined();
    expect((await readJsonFile<{ activeProviderId?: string }>(configFilePath)).activeProviderId).toBeUndefined();
    expect(globalState.get<string>(activeProviderIdKey)).toBeUndefined();
  });

  it("resets built-in presets without removing custom providers", async () => {
    const { store } = await createStore();
    await store.ensureBuiltInPresets();
    const custom = await store.addProvider({ name: "Custom Real", authType: "oauth" });

    const providers = await store.resetBuiltInPresets();

    expect(providers.some((provider) => provider.id === custom.id)).toBe(true);
    expect(providers.some((provider) => provider.name === "Anthropic Official")).toBe(true);
    expect(providers.some((provider) => provider.name === "DeepSeek")).toBe(true);
    expect(providers.some((provider) => provider.name === "智谱 GLM")).toBe(true);
    expect(providers.some((provider) => provider.name === "Kimi")).toBe(true);
    expect(providers.some((provider) => provider.name === "通义千问 / 阿里云百炼")).toBe(true);
    expect(providers.some((provider) => provider.name === "MiniMax")).toBe(true);
  });

  it("adds missing built-in presets without overwriting existing presets", async () => {
    const { store, globalState, configFilePath } = await createStore();
    const editedDeepSeek = {
      id: presetIds.deepSeek,
      name: "My DeepSeek",
      authType: "anthropic-auth-token" as const,
      baseUrl: "https://example.test/anthropic",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    await globalState.update(providersKey, [editedDeepSeek]);

    await store.ensureBuiltInPresets();
    const providers = await store.getProviders();

    expect(providers.find((provider) => provider.id === presetIds.deepSeek)?.name).toBe("My DeepSeek");
    expect(providers.some((provider) => provider.id === presetIds.zhipuGlm)).toBe(true);
    expect(providers.some((provider) => provider.id === presetIds.kimi)).toBe(true);
    expect(providers.some((provider) => provider.id === presetIds.qwenBailian)).toBe(true);
    expect(providers.some((provider) => provider.id === presetIds.minimax)).toBe(true);
    expect((await readJsonFile<{ providers: unknown[] }>(configFilePath)).providers).toHaveLength(providers.length);
  });

  it("migrates the old built-in DeepSeek preset defaults", async () => {
    const { store, globalState } = await createStore();
    await globalState.update(providersKey, [
      {
        id: presetIds.deepSeek,
        name: "DeepSeek",
        authType: "anthropic-auth-token" as const,
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-chat",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);

    await store.ensureBuiltInPresets();
    const deepSeek = (await store.getProviders()).find((provider) => provider.id === presetIds.deepSeek);

    expect(deepSeek?.model).toBe("deepseek-v4-pro[1m]");
    expect(deepSeek?.opusModel).toBe("deepseek-v4-pro[1m]");
    expect(deepSeek?.haikuModel).toBe("deepseek-v4-flash");
    expect(deepSeek?.subagentModel).toBe("deepseek-v4-flash");
    expect(deepSeek?.effortLevel).toBe("max");
    expect(deepSeek?.chatBaseUrl).toBe("https://api.deepseek.com");
    expect(deepSeek?.chatModel).toBe("deepseek-v4-pro");
  });

  it("migrates legacy token files into the provider config", async () => {
    const { store, legacyTokenFilePath, configFilePath } = await createStore();
    const provider = await store.addProvider({ name: "Legacy", authType: "anthropic-auth-token" });
    await fs.writeFile(legacyTokenFilePath, `${JSON.stringify({ [provider.id]: "legacy-token" })}\n`, "utf8");

    expect(await store.getToken(provider.id)).toBe("legacy-token");

    const config = await readJsonFile<{ tokens: Record<string, string> }>(configFilePath);
    expect(config.tokens[provider.id]).toBe("legacy-token");
  });

  it("loads config files that were written with a UTF-8 BOM", async () => {
    const { store, configFilePath } = await createStore();
    await fs.writeFile(
      configFilePath,
      `\ufeff${JSON.stringify({
        version: 1,
        providers: [
          {
            id: presetIds.deepSeek,
            name: "DeepSeek",
            authType: "anthropic-auth-token",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        tokens: {
          [presetIds.deepSeek]: "bom-token"
        }
      })}\n`,
      "utf8"
    );

    expect(await store.getProviders()).toHaveLength(1);
    expect(await store.getToken(presetIds.deepSeek)).toBe("bom-token");
  });

  it("does not lose custom providers when the config file becomes corrupt", async () => {
    const { store, configFilePath } = await createStore();
    await store.ensureBuiltInPresets();
    const custom = await store.addProvider({ name: "My Custom", authType: "anthropic-api-key" }, "tok");

    // Simulate a truncated / half-written config.json on disk \u2014 exactly what a
    // crashed or interrupted non-atomic write leaves behind.
    await fs.writeFile(configFilePath, "{ \"version\": 1, \"providers\": [", "utf8");

    await store.ensureBuiltInPresets();
    const providers = await store.getProviders();

    expect(providers.some((provider) => provider.id === custom.id)).toBe(true);
    expect(providers.some((provider) => provider.name === "My Custom")).toBe(true);
  });

  it("does not lose custom providers when globalState is the only source after disk failure", async () => {
    const { store, globalState, configFilePath } = await createStore();
    await store.ensureBuiltInPresets();
    const custom = await store.addProvider({ name: "Survivor", authType: "oauth" });

    // Wipe the file entirely so loadProviders falls back to globalState.
    await fs.rm(configFilePath, { force: true });
    // globalState currently holds the last fully-saved provider list.
    expect(globalState.get<unknown[]>(providersKey)).toBeDefined();

    await store.ensureBuiltInPresets();
    const providers = await store.getProviders();

    expect(providers.some((provider) => provider.id === custom.id)).toBe(true);
  });

  it("serializes concurrent provider updates so none are lost", async () => {
    const { store } = await createStore();
    await store.ensureBuiltInPresets();

    // Fire several addProvider + setToken + setActiveProviderId races.
    const added = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        store.addProvider({ name: `P${index}`, authType: "anthropic-auth-token" }, `tok-${index}`)
      )
    );

    await Promise.all(added.map((provider) => store.setActiveProviderId(provider.id)));
    const providers = await store.getProviders();

    for (const provider of added) {
      expect(providers.some((candidate) => candidate.id === provider.id)).toBe(true);
      expect(await store.getToken(provider.id)).toBeDefined();
    }
  });
});
