import { ProviderProfile } from "./types";

export type DirectChatRole = "system" | "user" | "assistant";

export interface DirectChatMessage {
  role: DirectChatRole;
  content: string;
}

interface ChatCompletionChoice {
  message?: {
    content?: unknown;
    reasoning_content?: unknown;
  };
}

interface ChatCompletionResponse {
  choices?: unknown;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<FetchResponseLike>;

export async function sendDirectChat(
  provider: ProviderProfile,
  token: string | undefined,
  messages: DirectChatMessage[],
  fetchImpl: FetchLike = fetch,
  modelOverride?: string,
  includeReasoning = true
): Promise<string> {
  if (!token?.trim()) {
    throw new Error("API key or token is missing for direct chat.");
  }

  const chatBaseUrl = resolveChatBaseUrl(provider);
  const chatModel = resolveChatModel(provider, modelOverride);
  const endpoint = `${trimTrailingSlash(chatBaseUrl)}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.trim()}`
    },
    body: JSON.stringify({
      model: chatModel,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      stream: false,
      ...createEffortPayload(provider.effortLevel)
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Direct chat request failed (${response.status} ${response.statusText}): ${safeBody(bodyText)}`);
  }

  const parsed = parseJsonObject(bodyText);
  const content = readAssistantContent(parsed, includeReasoning);
  if (!content) {
    throw new Error("Direct chat response did not contain assistant content.");
  }

  return content;
}

export function resolveChatBaseUrl(provider: ProviderProfile): string {
  if (provider.chatBaseUrl?.trim()) {
    return provider.chatBaseUrl.trim();
  }

  const baseUrl = provider.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Direct chat base URL is missing.");
  }

  return inferOpenAICompatibleBaseUrl(baseUrl);
}

export function resolveChatModel(provider: ProviderProfile, modelOverride?: string): string {
  return (
    modelOverride?.trim() ||
    provider.chatModel?.trim() ||
    stripClaudeCodeModelSuffix(provider.model?.trim()) ||
    stripClaudeCodeModelSuffix(provider.sonnetModel?.trim()) ||
    "deepseek-v4-pro"
  );
}

function inferOpenAICompatibleBaseUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  const host = readHostname(normalized);
  if (host.includes("dashscope.aliyuncs.com") || host.includes("maas.aliyuncs.com")) {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }

  if (host === "api.moonshot.cn") {
    return "https://api.moonshot.cn/v1";
  }

  if (host === "open.bigmodel.cn" || host === "api.z.ai") {
    return `${new URL(normalized).origin}/api/paas/v4`;
  }

  if (host.includes("minimax")) {
    return `${new URL(normalized).origin}/v1`;
  }

  if (normalized.endsWith("/anthropic")) {
    return normalized.slice(0, -"/anthropic".length);
  }

  return normalized;
}

function readHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function createEffortPayload(effortLevel: ProviderProfile["effortLevel"]): Record<string, string> {
  if (!effortLevel) {
    return {};
  }

  return {
    reasoning_effort: effortLevel === "max" ? "high" : effortLevel
  };
}

function readAssistantContent(value: unknown, includeReasoning = true): string | undefined {
  const response = readRecord(value) as ChatCompletionResponse | undefined;
  if (!Array.isArray(response?.choices)) {
    return undefined;
  }

  const choice = response.choices[0] as ChatCompletionChoice | undefined;
  const content = readContent(choice?.message?.content);
  if (!includeReasoning) {
    return content;
  }

  const reasoning = readContent(choice?.message?.reasoning_content);
  return [reasoning, content].filter(Boolean).join(reasoning && content ? "\n\n" : "") || content;
}

function readContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((part) => {
      const record = readRecord(part);
      return record ? readString(record.text) : undefined;
    })
    .filter(Boolean)
    .join("");
  return text.trim() || undefined;
}

function parseJsonObject(value: string): unknown {
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
  return typeof value === "string" ? value : undefined;
}

function stripClaudeCodeModelSuffix(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/\[[^\]]+\]$/, "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function safeBody(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "empty response body";
  }

  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}
