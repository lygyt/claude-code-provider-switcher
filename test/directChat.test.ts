import { describe, expect, it, vi } from "vitest";
import { resolveChatBaseUrl, resolveChatModel, sendDirectChat } from "../src/directChat";
import { ProviderProfile } from "../src/types";

function provider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: "provider-id",
    name: "DeepSeek",
    authType: "anthropic-auth-token",
    baseUrl: "https://api.deepseek.com/anthropic",
    model: "deepseek-v4-pro[1m]",
    chatBaseUrl: "https://api.deepseek.com",
    chatModel: "deepseek-v4-pro",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("directChat", () => {
  it("resolves direct chat settings from a provider", () => {
    expect(resolveChatBaseUrl(provider())).toBe("https://api.deepseek.com");
    expect(resolveChatModel(provider())).toBe("deepseek-v4-pro");
    expect(resolveChatBaseUrl(provider({ chatBaseUrl: undefined }))).toBe("https://api.deepseek.com");
    expect(resolveChatModel(provider({ chatModel: undefined }))).toBe("deepseek-v4-pro");
    expect(resolveChatBaseUrl(provider({ chatBaseUrl: undefined, baseUrl: "https://api.moonshot.cn/anthropic" }))).toBe(
      "https://api.moonshot.cn/v1"
    );
    expect(resolveChatBaseUrl(provider({ chatBaseUrl: undefined, baseUrl: "https://open.bigmodel.cn/api/anthropic" }))).toBe(
      "https://open.bigmodel.cn/api/paas/v4"
    );
    expect(
      resolveChatBaseUrl(provider({ chatBaseUrl: undefined, baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic" }))
    ).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("sends an OpenAI-compatible chat completion request", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ choices: [{ message: { content: "hello" } }] })
    }));

    const answer = await sendDirectChat(provider({ effortLevel: "max" }), "secret", [{ role: "user", content: "hi" }], fetchImpl);

    expect(answer).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret"
        }),
        body: expect.stringContaining('"reasoning_effort":"high"')
      })
    );
  });

  it("excludes reasoning_content when includeReasoning is false", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          choices: [
            { message: { content: "FINAL ANSWER", reasoning_content: "private chain of thought" } }
          ]
        })
    }));

    const answer = await sendDirectChat(provider(), "secret", [{ role: "user", content: "hi" }], fetchImpl, undefined, false);
    expect(answer).toBe("FINAL ANSWER");
  });

  it("includes reasoning_content by default", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          choices: [
            { message: { content: "FINAL ANSWER", reasoning_content: "private chain of thought" } }
          ]
        })
    }));

    const answer = await sendDirectChat(provider(), "secret", [{ role: "user", content: "hi" }], fetchImpl);
    expect(answer).toContain("private chain of thought");
    expect(answer).toContain("FINAL ANSWER");
  });
});
