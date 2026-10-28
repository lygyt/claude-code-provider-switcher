export type PromptPlacement = "off" | "prepend" | "append";
export interface PromptSettings { text: string; placement: PromptPlacement }

/** Read the prompt settings for the current workspace. */
export function getPromptSettings(api: { workspace: { getConfiguration(section: string): { get<T>(key: string, fallback: T): T } } }): PromptSettings {
  const config = api.workspace.getConfiguration("claudeCodeProviderSwitcher");
  const text = config.get("promptTemplate", "");
  const placement = config.get<string>("promptPlacement", "off");
  return {
    text: typeof text === "string" ? text : "",
    placement: placement === "prepend" || placement === "append" ? placement : "off"
  };
}

/** Add the configured prompt to a nonempty message once, preserving the draft. */
export function applyAutomaticPrompt(message: string, settings: PromptSettings): string {
  const input = typeof message === "string" ? message : "";
  const template = typeof settings?.text === "string" ? settings.text.trim() : "";
  if (!input.trim() || !template || input.includes(template)) return input;
  if (settings.placement === "prepend") return `${template}\n\n${input}`;
  if (settings.placement === "append") return `${input}\n\n${template}`;
  return input;
}

/** Replace the selected range with the prompt and return the new caret position. */
export function insertPromptAtSelection(value: string, start: number, end: number, text: string): { value: string; cursor: number } {
  const input = typeof value === "string" ? value : "";
  const template = typeof text === "string" ? text : "";
  const clamp = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.min(input.length, Math.floor(n))) : input.length;
  const a = clamp(start);
  const b = clamp(end);
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return { value: input.slice(0, from) + template + input.slice(to), cursor: from + template.length };
}
