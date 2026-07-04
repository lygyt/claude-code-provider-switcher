import { describe, expect, it } from "vitest";
import {
  isValidHttpUrl,
  validateProviderName,
  validateTokenRequirement
} from "../src/validation";

describe("validation", () => {
  it("accepts https URLs", () => {
    expect(isValidHttpUrl("https://api.deepseek.com/anthropic")).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(isValidHttpUrl("http://localhost:3000/anthropic")).toBe(true);
  });

  it("rejects invalid URLs", () => {
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
  });

  it("allows empty URLs when optional", () => {
    expect(isValidHttpUrl("")).toBe(true);
    expect(isValidHttpUrl(undefined)).toBe(true);
  });

  it("rejects empty provider names", () => {
    expect(validateProviderName("   ").valid).toBe(false);
  });

  it("does not require a token for OAuth", () => {
    expect(validateTokenRequirement("oauth", undefined).valid).toBe(true);
  });

  it("requires a token for token-based auth types", () => {
    expect(validateTokenRequirement("anthropic-auth-token", "").valid).toBe(false);
    expect(validateTokenRequirement("anthropic-api-key", undefined).valid).toBe(false);
    expect(validateTokenRequirement("anthropic-api-key", "token").valid).toBe(true);
  });
});
