import { describe, expect, it, vi } from "vitest";
import { fetchProviderModels, resolveModelListEndpoints } from "../src/providerModels";
import { ProviderProfile } from "../src/types";

function provider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: "provider-id",
    name: "Provider",
    authType: "anthropic-auth-token",
    baseUrl: "https://api.deepseek.com/anthropic",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("providerModels", () => {
  it("infers model endpoints for common provider presets", () => {
    expect(resolveModelListEndpoints(provider({ baseUrl: "https://api.deepseek.com/anthropic" }))).toContain(
      "https://api.deepseek.com/models"
    );
    expect(resolveModelListEndpoints(provider({ baseUrl: "https://api.moonshot.cn/anthropic" }))[0]).toBe(
      "https://api.moonshot.cn/v1/models"
    );
    expect(resolveModelListEndpoints(provider({ baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic" }))[0]).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models"
    );
    expect(resolveModelListEndpoints(provider({ baseUrl: "https://open.bigmodel.cn/api/anthropic" }))[0]).toBe(
      "https://open.bigmodel.cn/api/paas/v4/models"
    );
  });

  it("fetches and sorts OpenAI-compatible model ids", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] })
    }));

    const result = await fetchProviderModels(provider(), "secret", fetchImpl);

    expect(result.models).toEqual(["model-a", "model-b"]);
    expect(result.endpoint).toBe("https://api.deepseek.com/models");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer secret"
        })
      })
    );
  });

  it("tries the next inferred endpoint when the first one fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => ""
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ models: ["fallback-model"] })
      });

    const result = await fetchProviderModels(
      provider({
        chatBaseUrl: "https://example.test/v1",
        baseUrl: "https://api.deepseek.com/anthropic"
      }),
      "secret",
      fetchImpl
    );

    expect(result.endpoint).toBe("https://api.deepseek.com/models");
    expect(result.models).toEqual(["fallback-model"]);
  });
});
