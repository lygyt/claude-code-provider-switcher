import { ProviderProfile, ProviderProfileDraft } from "./types";
import { nowIso } from "./utils";

export const presetIds = {
  anthropicOfficial: "preset-anthropic-official",
  zhipuGlm: "preset-zhipu-glm",
  deepSeek: "preset-deepseek",
  kimi: "preset-kimi",
  qwenBailian: "preset-qwen-bailian",
  minimax: "preset-minimax",
  customProvider: "preset-custom-provider"
} as const;

export const presetDrafts: Record<string, ProviderProfileDraft> = {
  [presetIds.anthropicOfficial]: {
    name: "Anthropic Official",
    authType: "oauth"
  },
  [presetIds.zhipuGlm]: {
    name: "智谱 GLM",
    authType: "anthropic-auth-token",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-5.2[1m]",
    chatBaseUrl: "https://open.bigmodel.cn/api/paas/v4"
  },
  [presetIds.deepSeek]: {
    name: "DeepSeek",
    authType: "anthropic-auth-token",
    baseUrl: "https://api.deepseek.com/anthropic",
    model: "deepseek-v4-pro[1m]",
    opusModel: "deepseek-v4-pro[1m]",
    sonnetModel: "deepseek-v4-pro[1m]",
    haikuModel: "deepseek-v4-flash",
    subagentModel: "deepseek-v4-flash",
    effortLevel: "max",
    chatBaseUrl: "https://api.deepseek.com",
    chatModel: "deepseek-v4-pro"
  },
  [presetIds.kimi]: {
    name: "Kimi",
    authType: "anthropic-auth-token",
    baseUrl: "https://api.moonshot.cn/anthropic",
    model: "kimi-k2.7-code",
    chatBaseUrl: "https://api.moonshot.cn/v1"
  },
  [presetIds.qwenBailian]: {
    name: "通义千问 / 阿里云百炼",
    authType: "anthropic-auth-token",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    model: "qwen3.6-plus",
    chatBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  [presetIds.minimax]: {
    name: "MiniMax",
    authType: "anthropic-auth-token",
    baseUrl: "https://api.minimaxi.com/anthropic",
    model: "MiniMax-M3[1m]"
  },
  [presetIds.customProvider]: {
    name: "Custom Provider",
    authType: "anthropic-auth-token"
  }
};

export function createBuiltInPresets(timestamp = nowIso()): ProviderProfile[] {
  return Object.entries(presetDrafts).map(([id, draft]) => ({
    id,
    ...draft,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}
