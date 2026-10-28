import * as vscode from "vscode";
import { fetchProviderModels } from "./providerModels";
import { ProviderStore } from "./providerStore";
import { ProviderProfile } from "./types";
import { showSafeError } from "./vscodeUtils";

type ModelChoice = vscode.QuickPickItem & { action: "model" | "default" | "manual" | "load"; model?: string };

/** Models already configured for this provider, without fetching or altering credentials. */
export function configuredModels(provider: ProviderProfile): string[] {
  return [...new Set([provider.model, provider.opusModel, provider.sonnetModel, provider.haikuModel, provider.subagentModel]
    .map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

/** Select the model for subsequent Claude CLI turns of the active provider. */
export async function selectProviderModel(store: ProviderStore, onChanged: () => void | Promise<void>): Promise<void> {
  try {
    const provider = await store.getActiveProvider();
    if (!provider) {
      await vscode.window.showWarningMessage("请先选择 Provider，再选择模型。");
      return;
    }
    let models = configuredModels(provider);
    let loaded = false;
    while (true) {
      const choices: ModelChoice[] = [
        { label: "使用 Provider 默认模型", description: provider.model ? undefined : "当前", action: "default" },
        ...models.map((model): ModelChoice => ({ label: model, description: model === provider.model ? "当前" : undefined, action: "model", model })),
        { label: "$(edit) 手动输入模型 ID…", action: "manual" },
        { label: loaded ? "$(refresh) 重新加载模型列表" : "$(cloud-download) 加载 Provider 可用模型", action: "load", detail: "仅在选择此项时请求 Provider 的模型接口" }
      ];
      const choice = await vscode.window.showQuickPick(choices, { title: `选择模型 · ${provider.name}`, placeHolder: "选择模型，或手动输入模型 ID" });
      if (!choice) return;
      if (choice.action === "load") {
        try {
          const token = await store.getToken(provider.id);
          const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在加载 ${provider.name} 的模型…` }, () => fetchProviderModels(provider, token));
          models = [...new Set([...configuredModels(provider), ...result.models])];
          loaded = true;
        } catch (error) {
          showSafeError(error, "无法加载模型列表。可以手动输入模型 ID。");
        }
        continue;
      }
      let model = choice.action === "model" ? choice.model : undefined;
      if (choice.action === "manual") {
        const input = await vscode.window.showInputBox({ title: `模型 ID · ${provider.name}`, value: provider.model ?? "", placeHolder: "例如 claude-sonnet-4-6", ignoreFocusOut: true, validateInput: (value) => value.trim() ? undefined : "请输入模型 ID" });
        if (input === undefined) return;
        model = input.trim();
        if (!model) return;
      }
      // Reload before saving so another window's changes are not overwritten.
      const active = await store.getActiveProvider();
      if (!active || active.id !== provider.id) {
        await vscode.window.showWarningMessage("Provider 已切换，请重新选择模型。");
        return;
      }
      await store.updateProvider(active.id, { ...active, model }, { kind: "keep" });
      await onChanged();
      return;
    }
  } catch (error) {
    showSafeError(error, "选择模型失败。");
  }
}
