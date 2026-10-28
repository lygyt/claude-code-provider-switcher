import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathExists, readJson } from "./util.mjs";

export function defaultConfigPath() {
  return process.env.CCPS_CONFIG || path.join(os.homedir(), ".claude-code-provider-switcher", "config.json");
}

function providerFromEnvironment() {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const model = process.env.ANTHROPIC_MODEL;
  if (!baseUrl && !apiKey && !authToken) {
    return undefined;
  }

  return {
    id: "environment",
    name: "Environment",
    authType: apiKey ? "anthropic-api-key" : "anthropic-auth-token",
    baseUrl,
    model,
    opusModel: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    sonnetModel: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    haikuModel: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    subagentModel: process.env.CLAUDE_CODE_SUBAGENT_MODEL,
    token: apiKey || authToken,
    source: "environment"
  };
}

export async function loadProvider(options = {}) {
  const configPath = options.configPath ?? defaultConfigPath();
  if (!(await pathExists(configPath))) {
    return providerFromEnvironment();
  }

  let config;
  try {
    config = await readJson(configPath);
  } catch (error) {
    throw new Error(`Could not parse provider config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (!providers.length) {
    return providerFromEnvironment();
  }

  const requestedId = options.providerId || config.activeProviderId;
  const provider = requestedId
    ? providers.find((candidate) => candidate.id === requestedId)
    : providers[0];
  if (!provider) {
    throw new Error(`Provider "${requestedId}" was not found in ${configPath}.`);
  }

  const tokens = config.tokens && typeof config.tokens === "object" ? config.tokens : {};
  const configToken = typeof tokens[provider.id] === "string" ? tokens[provider.id] : undefined;
  const envToken = provider.authType === "anthropic-api-key"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.ANTHROPIC_AUTH_TOKEN;
  const token = configToken || envToken;

  return {
    id: provider.id,
    name: provider.name || provider.id,
    authType: provider.authType || "anthropic-auth-token",
    baseUrl: provider.baseUrl,
    model: provider.model,
    opusModel: provider.opusModel,
    sonnetModel: provider.sonnetModel,
    haikuModel: provider.haikuModel,
    subagentModel: provider.subagentModel,
    token,
    source: configPath
  };
}

export function providerEnv(provider) {
  if (!provider) {
    return {};
  }

  const env = {};
  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
  }
  if (provider.opusModel) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.opusModel;
  }
  if (provider.sonnetModel) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.sonnetModel;
  }
  if (provider.haikuModel) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.haikuModel;
  }
  if (provider.subagentModel) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = provider.subagentModel;
  }
  if (provider.model) {
    env.ANTHROPIC_MODEL = provider.model;
  }
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";

  if (provider.token) {
    if (provider.authType === "anthropic-api-key") {
      env.ANTHROPIC_API_KEY = provider.token;
    } else {
      env.ANTHROPIC_AUTH_TOKEN = provider.token;
    }
  }

  return env;
}

export function childProcessEnv(provider, baseEnv = process.env) {
  if (!provider) {
    return { ...baseEnv };
  }
  const env = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  Object.assign(env, providerEnv(provider));
  return env;
}

export function redactProvider(provider) {
  if (!provider) {
    return undefined;
  }
  return {
    id: provider.id,
    name: provider.name,
    authType: provider.authType,
    baseUrl: provider.baseUrl,
    model: provider.model,
    hasToken: Boolean(provider.token),
    source: provider.source
  };
}
