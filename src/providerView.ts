import * as vscode from "vscode";
import { ProviderStore } from "./providerStore";
import { ProviderStatusBar } from "./statusBar";
import { getConfig, showSafeError } from "./vscodeUtils";

type ProviderViewMessage =
  | { type: "ready" }
  | { type: "refresh"; selectedProviderId?: string }
  | { type: "selectProvider"; providerId: string }
  | { type: "saveProviderToken"; providerId: string; token: string }
  | { type: "removeProviderToken"; providerId: string }
  | { type: "setPermissionMode"; permissionMode: string };

interface ProviderViewState {
  providers: Array<{
    id: string;
    name: string;
    authType: string;
  }>;
  activeProviderId?: string;
  tokenStatus: Record<string, boolean>;
  permissionMode: string;
}

export class ProviderWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  public constructor(
    private readonly store: ProviderStore,
    private readonly statusBar: ProviderStatusBar
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = createHtml();
    webviewView.webview.onDidReceiveMessage((message: ProviderViewMessage) => {
      void this.handleMessage(message).catch((error: unknown) => {
        showSafeError(error, "Claude Code provider panel action failed.");
      });
    });
  }

  public refresh(): void {
    void this.postState().catch((error: unknown) => {
      showSafeError(error, "Claude Code provider panel refresh failed.");
    });
  }

  private async handleMessage(message: ProviderViewMessage): Promise<void> {
    if (message.type === "ready" || message.type === "refresh") {
      await this.postState(message.type === "refresh" ? message.selectedProviderId : undefined);
      return;
    }

    if (message.type === "selectProvider") {
      await this.store.setActiveProviderId(message.providerId);
      await this.statusBar.refresh();
      await this.postState(message.providerId);

      if (getConfig().launchAfterSelection) {
        await vscode.commands.executeCommand("claudeCodeProviderSwitcher.launchCurrentProvider");
      }
      return;
    }

    if (message.type === "saveProviderToken") {
      const token = message.token.trim();
      if (!token) {
        throw new Error("API key or token is required.");
      }

      await this.store.setToken(message.providerId, token);
      await this.postState(message.providerId);
      return;
    }

    if (message.type === "setPermissionMode") {
      try {
        await vscode.workspace.getConfiguration("claudeCodeProviderSwitcher").update(
          "permissionMode",
          message.permissionMode,
          vscode.ConfigurationTarget.Global
        );
      } catch (error) {
        showSafeError(
          error,
          "Failed to save permission mode. Check that your VS Code settings.json is valid JSON " +
            "and not write-protected, then try again."
        );
        return;
      }
      await this.postState();
      return;
    }

    await this.store.deleteToken(message.providerId);
    await this.postState(message.providerId);
  }

  private async postState(selectedProviderId?: string): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.store.ensureBuiltInPresets();
    const providers = await this.store.getProviders();
    const activeProviderId = await this.store.getActiveProviderId();
    const resolvedSelectedProviderId = selectedProviderId ?? activeProviderId ?? providers[0]?.id;
    const tokenStatus: Record<string, boolean> = {};
    for (const provider of providers) {
      tokenStatus[provider.id] = await this.store.hasToken(provider.id);
    }
    const permissionMode = vscode.workspace.getConfiguration("claudeCodeProviderSwitcher").get<string>("permissionMode", "requestApproval");
    const state: ProviderViewState = {
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        authType: provider.authType
      })),
      activeProviderId,
      tokenStatus,
      permissionMode
    };

    await this.view.webview.postMessage({
      type: "state",
      state,
      selectedProviderId: resolvedSelectedProviderId
    });
  }
}

function createHtml(): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Code Providers</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }

    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 12px;
    }

    label {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .label-text {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    input,
    select {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      box-sizing: border-box;
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      min-height: 30px;
      padding: 4px 7px;
      width: 100%;
    }

    .section {
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border));
      margin-top: 12px;
      padding-top: 12px;
    }

    .label-row {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      min-width: 0;
    }

    .token-saved {
      color: var(--vscode-charts-green);
      font-size: 11px;
    }

    .actions {
      display: grid;
      gap: 8px;
      grid-template-columns: 1fr 1fr;
      margin-top: 8px;
    }

    button {
      align-items: center;
      background: var(--vscode-button-secondaryBackground);
      border: 0;
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      display: inline-flex;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      justify-content: center;
      min-height: 28px;
      padding: 5px 9px;
      text-align: center;
    }

    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      cursor: default;
      opacity: 0.6;
    }

    input:focus,
    select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .message {
      color: var(--vscode-descriptionForeground);
      min-height: 18px;
      margin-top: 10px;
      word-break: break-word;
    }

    .message.error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <label>
    <span class="label-text">Provider</span>
    <select id="providerSelect" aria-label="Provider"></select>
  </label>

  <label style="margin-top:10px">
    <span class="label-text">Permission Mode</span>
    <select id="permissionModeSelect" aria-label="Permission Mode">
      <option value="requestApproval">Request Approval (default)</option>
      <option value="fullAccess">Full Access</option>
    </select>
  </label>

  <div class="section">
    <label>
      <span class="label-row">
        <span class="label-text">API Key / Token</span>
        <span id="tokenSavedBadge" class="token-saved" style="display:none">Saved</span>
      </span>
      <input id="tokenInput" type="password" autocomplete="off" placeholder="Paste key for current provider">
    </label>
    <div class="actions">
      <button id="saveTokenButton" class="primary">Save Key</button>
      <button id="removeTokenButton">Remove</button>
    </div>
  </div>

  <div id="message" class="message"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providerSelect = document.getElementById("providerSelect");
    const permissionModeSelect = document.getElementById("permissionModeSelect");
    const tokenInput = document.getElementById("tokenInput");
    const tokenSavedBadge = document.getElementById("tokenSavedBadge");
    const saveTokenButton = document.getElementById("saveTokenButton");
    const removeTokenButton = document.getElementById("removeTokenButton");
    const message = document.getElementById("message");

    let state = {
      providers: [],
      activeProviderId: undefined,
      tokenStatus: {},
      permissionMode: "requestApproval"
    };
    let selectedProviderId = undefined;

    window.addEventListener("message", (event) => {
      if (event.data.type !== "state") {
        return;
      }

      state = event.data.state;
      selectedProviderId = event.data.selectedProviderId || selectedProviderId || state.activeProviderId || state.providers[0]?.id;
      render();
    });

    providerSelect.addEventListener("change", () => {
      selectedProviderId = providerSelect.value;
      const provider = getSelectedProvider();
      if (!provider) {
        setMessage("No provider selected.", true);
        return;
      }

      post({ type: "selectProvider", providerId: provider.id });
      setMessage(provider.name);
    });

    permissionModeSelect.addEventListener("change", () => {
      post({ type: "setPermissionMode", permissionMode: permissionModeSelect.value });
      setMessage("Permission mode updated.");
    });

    saveTokenButton.addEventListener("click", () => {
      const provider = getSelectedProvider();
      const token = tokenInput.value.trim();
      if (!provider) {
        setMessage("No provider selected.", true);
        return;
      }

      if (!token) {
        setMessage("Paste an API key or token first.", true);
        return;
      }

      post({ type: "saveProviderToken", providerId: provider.id, token });
      tokenInput.value = "";
      setMessage("Saving key...");
    });

    removeTokenButton.addEventListener("click", () => {
      const provider = getSelectedProvider();
      if (!provider) {
        setMessage("No provider selected.", true);
        return;
      }

      post({ type: "removeProviderToken", providerId: provider.id });
      tokenInput.value = "";
      setMessage("Removing key...");
    });

    function render() {
      providerSelect.innerHTML = "";
      for (const provider of state.providers) {
        const option = document.createElement("option");
        option.value = provider.id;
        option.textContent = provider.id === state.activeProviderId ? "* " + provider.name : provider.name;
        providerSelect.append(option);
      }

      if (!selectedProviderId || !state.providers.some((provider) => provider.id === selectedProviderId)) {
        selectedProviderId = state.activeProviderId || state.providers[0]?.id;
      }

      providerSelect.value = selectedProviderId || "";
      permissionModeSelect.value = state.permissionMode || "requestApproval";
      const provider = getSelectedProvider();
      renderToken(provider);
      setMessage(provider ? provider.name : "No providers configured.", !provider);
    }

    function renderToken(provider) {
      const hasProvider = Boolean(provider);
      const usesToken = provider && provider.authType !== "oauth";
      const hasToken = provider && state.tokenStatus[provider.id] === true;
      tokenInput.disabled = !hasProvider || !usesToken;
      saveTokenButton.disabled = !hasProvider || !usesToken;
      removeTokenButton.disabled = !hasProvider || !usesToken || !hasToken;
      // Do NOT clear tokenInput.value here — the user may be typing.
      // Only save/remove handlers clear it after their explicit actions.
      tokenInput.placeholder = !provider
        ? "No provider selected"
        : usesToken
          ? hasToken
            ? "Saved key will be reused; paste a new key to replace"
            : "Paste key for current provider"
          : "OAuth provider uses Claude login";
      tokenSavedBadge.style.display = hasToken ? "inline" : "none";
    }

    function getSelectedProvider() {
      return state.providers.find((provider) => provider.id === selectedProviderId);
    }

    function post(value) {
      vscode.postMessage(value);
    }

    function setMessage(value, isError = false) {
      message.textContent = value;
      message.classList.toggle("error", isError);
    }

    post({ type: "ready" });
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}
