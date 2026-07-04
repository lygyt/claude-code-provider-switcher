import * as vscode from "vscode";
import { ProviderProfile } from "./types";

export type ProviderPickerAction =
  | "add"
  | "edit"
  | "delete"
  | "launch-current"
  | "reset-presets";

export type ProviderPickerResult =
  | { kind: "provider"; provider: ProviderProfile }
  | { kind: "action"; action: ProviderPickerAction };

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  result: ProviderPickerResult;
}

const actionItems: Array<{ label: string; description: string; action: ProviderPickerAction }> = [
  { label: "$(add) Add Provider", description: "Create a new provider profile", action: "add" },
  { label: "$(edit) Edit Provider", description: "Update an existing provider profile", action: "edit" },
  { label: "$(trash) Delete Provider", description: "Remove a provider profile and its secret", action: "delete" },
  { label: "$(terminal) Launch Current Provider", description: "Open Claude Code with the active provider", action: "launch-current" },
  { label: "$(refresh) Reset Built-in Presets", description: "Restore Anthropic, DeepSeek, and Custom presets", action: "reset-presets" }
];

export async function pickProviderOrAction(
  providers: ProviderProfile[],
  activeProviderId: string | undefined
): Promise<ProviderPickerResult | undefined> {
  const providerItems: ProviderQuickPickItem[] = providers.map((provider) => ({
    label: `${provider.id === activeProviderId ? "$(check) " : ""}${provider.name}`,
    description: provider.model ?? "Default model",
    detail: provider.baseUrl ?? "Anthropic default",
    result: { kind: "provider", provider }
  }));

  const items: ProviderQuickPickItem[] = [
    ...providerItems,
    ...actionItems.map((item) => ({
      label: item.label,
      description: item.description,
      result: { kind: "action", action: item.action } satisfies ProviderPickerResult
    }))
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: "Claude Code Provider",
    placeHolder: providers.length === 0 ? "No providers yet. Add a provider to get started." : "Select a provider or action",
    matchOnDescription: true,
    matchOnDetail: true
  });

  return selected?.result;
}

export async function pickProvider(
  providers: ProviderProfile[],
  title: string,
  placeHolder: string
): Promise<ProviderProfile | undefined> {
  if (providers.length === 0) {
    await vscode.window.showInformationMessage("No providers are configured.");
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    providers.map((provider) => ({
      label: provider.name,
      description: provider.model ?? "Default model",
      detail: provider.baseUrl ?? "Anthropic default",
      provider
    })),
    { title, placeHolder, matchOnDescription: true, matchOnDetail: true }
  );

  return selected?.provider;
}
