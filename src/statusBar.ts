import * as vscode from "vscode";
import { ProviderStore } from "./providerStore";

export class ProviderStatusBar {
  private readonly item: vscode.StatusBarItem;

  public constructor(private readonly store: ProviderStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "claudeCodeProviderSwitcher.selectProvider";
    this.item.show();
  }

  public get disposable(): vscode.Disposable {
    return this.item;
  }

  public async refresh(): Promise<void> {
    const provider = await this.store.getActiveProvider();
    if (!provider) {
      this.item.text = "$(sparkle) CC: Select Provider";
      this.item.tooltip = "Claude Code Provider\nClick to select provider";
      return;
    }

    this.item.text = `$(sparkle) CC: ${provider.name}`;
    this.item.tooltip = [
      "Claude Code Provider",
      `Provider: ${provider.name}`,
      `Model: ${provider.model ?? "Default"}`,
      `Base URL: ${provider.baseUrl ?? "Anthropic default"}`,
      "Click to switch provider"
    ].join("\n");
  }
}
