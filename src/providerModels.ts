import { ProviderProfile } from "./types";
import { authTypeRequiresToken } from "./validation";

export interface ModelListResult {
  endpoint: string;
  models: string[];
}

export interface ModelFetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export type ModelFetchLike = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
  }
) => Promise<ModelFetchResponseLike>;

export async function fetchProviderModels(
  provider: ProviderProfile,
  token: string | undefined,
  fetchImpl: ModelFetchLike = fetch
): Promise<ModelListResult> {
  if (authTypeRequiresToken(provider.authType) && !token?.trim()) {
    throw new Error("Save an API key/token before loading models for this provider.");
  }

  const endpoints = resolveModelListEndpoints(provider);
  if (endpoints.length === 0) {
    throw new Error("Model list endpoint could not be inferred. Set Direct Chat Base URL first.");
  }

  const headers: Record<string, string> = {};
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const failures: string[] = [];
  for (const endpoint of endpoints) {
    let bodyText = "";
    try {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        headers
      });
      bodyText = await response.text();
      if (!response.ok) {
        failures.push(`${endpoint} (${response.status} ${response.statusText})`);
        continue;
      }

      const models = extractModelIds(parseJson(bodyText));
      if (models.length > 0) {
        return { endpoint, models };
      }

      failures.push(`${endpoint} (no models in response)`);
    } catch (error) {
      failures.push(`${endpoint} (${readErrorMessage(error)})`);
    }
  }

  throw new Error(`Could not load provider models. Tried: ${failures.join("; ")}`);
}

export function resolveModelListEndpoints(provider: ProviderProfile): string[] {
  return uniqueStrings(resolveModelApiBaseUrls(provider).map((baseUrl) => `${trimTrailingSlash(baseUrl)}/models`));
}

function resolveModelApiBaseUrls(provider: ProviderProfile): string[] {
  const baseUrls: string[] = [];
  addIfPresent(baseUrls, provider.chatBaseUrl);

  const baseUrl = provider.baseUrl?.trim();
  if (baseUrl) {
    for (const candidate of inferOpenAICompatibleBaseUrls(baseUrl)) {
      addIfPresent(baseUrls, candidate);
    }
  }

  return uniqueStrings(baseUrls);
}

function inferOpenAICompatibleBaseUrls(baseUrl: string): string[] {
  const normalized = trimTrailingSlash(baseUrl);
  const candidates: string[] = [];
  const host = readHostname(normalized);

  if (host.includes("dashscope.aliyuncs.com") || host.includes("maas.aliyuncs.com")) {
    candidates.push(replacePath(normalized, "/compatible-mode/v1"));
  }

  if (host === "api.moonshot.cn") {
    candidates.push(replacePath(normalized, "/v1"));
  }

  if (host === "open.bigmodel.cn" || host === "api.z.ai") {
    candidates.push(replacePath(normalized, "/api/paas/v4"));
  }

  if (host.includes("minimax")) {
    candidates.push(replacePath(normalized, "/v1"));
  }

  if (normalized.endsWith("/anthropic")) {
    candidates.push(normalized.slice(0, -"/anthropic".length));
  }

  candidates.push(normalized);
  return candidates;
}

function extractModelIds(value: unknown): string[] {
  const record = readRecord(value);
  const arrays = Array.isArray(value)
    ? [value]
    : [record?.data, record?.models, record?.model_list, record?.modelList].filter(Array.isArray);

  const ids = arrays.flatMap((array) =>
    array
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        const itemRecord = readRecord(item);
        return readString(itemRecord?.id) ?? readString(itemRecord?.model) ?? readString(itemRecord?.name);
      })
      .filter((modelId): modelId is string => Boolean(modelId?.trim()))
      .map((modelId) => modelId.trim())
  );

  return uniqueStrings(ids).sort((left, right) => left.localeCompare(right));
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function replacePath(value: string, pathname: string): string {
  try {
    const url = new URL(value);
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return trimTrailingSlash(url.toString());
  } catch {
    return value;
  }
}

function addIfPresent(values: string[], value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    values.push(trimTrailingSlash(trimmed));
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : "request failed";
}
