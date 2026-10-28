import * as vscode from "vscode";
import { ProviderStore } from "./providerStore";
import { SkillStore } from "./skillManager";
import { ProviderStatusBar } from "./statusBar";
import { ClaudeConversationHistoryProvider } from "./conversationHistory";
export class SidebarChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  constructor(store: ProviderStore, skillStore: SkillStore, statusBar: ProviderStatusBar, historyProvider: ClaudeConversationHistoryProvider);
  resolveWebviewView(view: vscode.WebviewView): void;
  open(sessionId?: string): Promise<void>;
  refresh(): Promise<void>;
  showPromptSettings(): Promise<void>;
  dispose(): void;
}
