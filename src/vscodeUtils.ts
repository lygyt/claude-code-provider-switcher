import * as vscode from "vscode";
import { ExtensionConfig } from "./types";
import { safeErrorMessage } from "./utils";

export function showSafeError(error: unknown, fallbackMessage: string): void {
  void vscode.window.showErrorMessage(safeErrorMessage(error, fallbackMessage));
}

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("claudeCodeProviderSwitcher");
  return {
    launchAfterSelection: config.get<boolean>("launchAfterSelection", true),
    checkClaudeCliBeforeLaunch: config.get<boolean>("checkClaudeCliBeforeLaunch", true),
    terminalNameFormat: config.get<string>("terminalNameFormat", "CC · ${provider}"),
    terminalLocation: config.get<"editor" | "panel">("terminalLocation", "editor"),
    conversationMode: config.get<"fresh" | "continue" | "resumePicker">("conversationMode", "fresh"),
    permissionMode: config.get<"requestApproval" | "fullAccess">("permissionMode", "requestApproval"),
    claudeExecutablePath: config.get<string>("claudeExecutablePath", "")
  };
}
