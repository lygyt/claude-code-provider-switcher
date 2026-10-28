import { describe, expect, it } from "vitest";
import { getPromptSettings, applyAutomaticPrompt, insertPromptAtSelection } from "../src/promptTemplate";

function mock(values: Record<string, unknown>) {
  return { workspace: { getConfiguration: (section: string) => {
    expect(section).toBe("claudeCodeProviderSwitcher");
    return { get: <T>(key: string, fallback: T): T => (values[key] ?? fallback) as T };
  } } };
}

describe("custom prompt", () => {
  it("loads settings and rejects invalid placement", () => {
    expect(getPromptSettings(mock({}))).toEqual({ text: "", placement: "off" });
    expect(getPromptSettings(mock({ promptTemplate: "Use Chinese", promptPlacement: "append" }))).toEqual({ text: "Use Chinese", placement: "append" });
    expect(getPromptSettings(mock({ promptPlacement: "invalid" })).placement).toBe("off");
  });
  it("applies an automatic prompt at the selected end only once", () => {
    expect(applyAutomaticPrompt("Question", { text: "  Use Chinese\n", placement: "prepend" })).toBe("Use Chinese\n\nQuestion");
    expect(applyAutomaticPrompt("Question", { text: "Use Chinese", placement: "append" })).toBe("Question\n\nUse Chinese");
    expect(applyAutomaticPrompt("Question\n\nUse Chinese", { text: "Use Chinese", placement: "append" })).toBe("Question\n\nUse Chinese");
    expect(applyAutomaticPrompt("  ", { text: "Use Chinese", placement: "prepend" })).toBe("  ");
    expect(applyAutomaticPrompt("Question", { text: "Use Chinese", placement: "off" })).toBe("Question");
  });
  it("replaces the selected range and positions the caret", () => {
    expect(insertPromptAtSelection("你好世界", 2, 4, "Claude")).toEqual({ value: "你好Claude", cursor: 8 });
    expect(insertPromptAtSelection("abcd", 3, 1, "X")).toEqual({ value: "aXd", cursor: 2 });
    expect(insertPromptAtSelection("abcd", -1, 99, "X")).toEqual({ value: "X", cursor: 1 });
  });
});
