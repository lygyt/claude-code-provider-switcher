import * as vscode from "vscode";
import { ProviderStore } from "./providerStore";
import { SkillStore, loadClaudeSkills } from "./skillManager";
import { fetchProviderModels } from "./providerModels";
import { ClaudeSkill, Workflow, WorkflowReviewLoop, WorkflowStep } from "./types";
import { createWorkflowStepId, WorkflowStore } from "./workflowStore";
import { showSafeError } from "./vscodeUtils";

interface EditorProviderOption {
  id: string;
  name: string;
}

interface EditorSkillOption {
  name: string;
  directory: string;
  scope: string;
}

interface EditorInitPayload {
  providers: EditorProviderOption[];
  skills: EditorSkillOption[];
  workflow?: Workflow;
}

type EditorInboundMessage =
  | { type: "ready" }
  | { type: "loadModels"; providerId: string }
  | { type: "save"; workflow: EditorWorkflowDraft };

interface EditorWorkflowDraft {
  id?: string;
  name: string;
  description?: string;
  reviewLoops?: WorkflowReviewLoop[];
  steps: Array<{
    id?: string;
    name: string;
    providerId: string;
    model: string;
    skillDirectory?: string;
    prompt: string;
    execute?: boolean;
    templatePath?: string;
  }>;
}

export class WorkflowEditor {
  public constructor(
    private readonly store: WorkflowStore,
    private readonly providerStore: ProviderStore,
    private readonly skillStore: SkillStore
  ) {}

  public async open(existing?: Workflow): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "claudeCodeProviderSwitcher.workflowEditor",
      existing ? `Edit: ${existing.name}` : "New Workflow",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.iconPath = new vscode.ThemeIcon("workflow");
    panel.webview.html = createEditorHtml();

    const [providers, skills] = await Promise.all([this.providerStore.getProviders(), loadClaudeSkills()]);

    const disposables: vscode.Disposable[] = [];
    const messageDisposable = panel.webview.onDidReceiveMessage((message: EditorInboundMessage) => {
      void this.handleMessage(panel, message, providers, skills).catch((error: unknown) => {
        showSafeError(error, "Workflow editor action failed.");
      });
    });
    disposables.push(messageDisposable);

    panel.onDidDispose(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });

    const payload: EditorInitPayload = {
      providers: providers.map((provider) => ({ id: provider.id, name: provider.name })),
      skills: skills.map((skill) => ({ name: skill.name, directory: skill.directory, scope: skill.scope })),
      workflow: existing
    };
    panel.webview.postMessage({ type: "init", payload });
  }

  private async handleMessage(
    panel: vscode.WebviewPanel,
    message: EditorInboundMessage,
    providers: Awaited<ReturnType<ProviderStore["getProviders"]>>,
    _skills: ClaudeSkill[]
  ): Promise<void> {
    if (message.type === "ready") {
      return;
    }

    if (message.type === "loadModels") {
      const provider = providers.find((candidate) => candidate.id === message.providerId);
      if (!provider) {
        panel.webview.postMessage({ type: "models", providerId: message.providerId, models: [], error: "Provider not found." });
        return;
      }

      const token = await this.providerStore.getToken(provider.id);
      const seedModels = uniqueStrings([
        provider.chatModel,
        provider.model,
        provider.opusModel,
        provider.sonnetModel,
        provider.haikuModel,
        provider.subagentModel
      ].filter(Boolean) as string[]);

      try {
        const result = await fetchProviderModels(provider, token);
        const models = uniqueStrings([...result.models, ...seedModels]).sort((left, right) => left.localeCompare(right));
        panel.webview.postMessage({ type: "models", providerId: message.providerId, models });
      } catch (error) {
        panel.webview.postMessage({
          type: "models",
          providerId: message.providerId,
          models: seedModels.sort((left, right) => left.localeCompare(right)),
          error: error instanceof Error ? error.message : "Could not load models; using configured defaults."
        });
      }
      return;
    }

    if (message.type === "save") {
      try {
        const steps: WorkflowStep[] = message.workflow.steps.map((step) => ({
          id: step.id?.trim() || createWorkflowStepId(),
          name: step.name.trim() || "Untitled step",
          providerId: step.providerId,
          model: step.model.trim(),
          skillDirectory: step.skillDirectory?.trim() || undefined,
          prompt: step.prompt,
          execute: step.execute === true,
          templatePath: step.templatePath?.trim() || undefined
        }));

        if (!message.workflow.name.trim()) {
          throw new Error("Workflow name is required.");
        }
        if (steps.length === 0) {
          throw new Error("Add at least one step before saving.");
        }
        const reviewLoops = normalizeEditorReviewLoops(message.workflow.reviewLoops, steps);

        let saved: Workflow;
        if (message.workflow.id) {
          saved = await this.store.updateWorkflow(message.workflow.id, {
            name: message.workflow.name,
            description: message.workflow.description,
            steps,
            reviewLoops
          });
        } else {
          saved = await this.store.createWorkflow(message.workflow.name, steps, message.workflow.description, reviewLoops);
        }

        panel.webview.postMessage({ type: "saved", workflow: saved });
        await vscode.window.showInformationMessage(`Workflow saved: ${saved.name}`);
        panel.dispose();
      } catch (error) {
        showSafeError(error, "Failed to save workflow.");
      }
    }
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function normalizeEditorReviewLoops(reviewLoops: WorkflowReviewLoop[] | undefined, steps: WorkflowStep[]): WorkflowReviewLoop[] | undefined {
  const loops = Array.isArray(reviewLoops) ? reviewLoops.filter((loop) => loop?.enabled) : [];
  const normalized: WorkflowReviewLoop[] = [];

  for (const loop of loops) {
    const reviseFromStepId = loop.reviseFromStepId?.trim();
    const reviewStepId = loop.reviewStepId?.trim();
    if (!reviseFromStepId || !reviewStepId) {
      throw new Error("Choose valid steps for every enabled review loop.");
    }
    const reviseFromIndex = steps.findIndex((step) => step.id === reviseFromStepId);
    const reviewIndex = steps.findIndex((step) => step.id === reviewStepId);
    if (reviseFromIndex < 0 || reviewIndex < 0) {
      throw new Error("Choose valid steps for every enabled review loop.");
    }
    if (reviseFromIndex >= reviewIndex) {
      throw new Error("Each loop's revision start step must come strictly before its review step.");
    }

    normalized.push({
      enabled: true,
      name: loop.name?.trim() || undefined,
      reviseFromStepId,
      reviewStepId,
      maxIterations: Math.min(Math.max(Math.trunc(loop.maxIterations || 3), 1), 20),
      approvalPattern: loop.approvalPattern?.trim() || undefined
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function createEditorHtml(): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Editor</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0; padding: 16px;
    }
    h1 { font-size: 16px; margin: 0 0 12px; }
    label { display: grid; gap: 4px; margin-bottom: 12px; }
    .label-text { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
    input, select, textarea {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      box-sizing: border-box;
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      min-height: 28px; padding: 4px 7px; width: 100%;
    }
    textarea { min-height: 70px; resize: vertical; font-family: var(--vscode-editor-font-family); }
    input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .step {
      border: 1px solid var(--vscode-widget-border, var(--vscode-sideBarSectionHeader-border, transparent));
      border-radius: 4px; padding: 12px; margin-bottom: 12px;
    }
    .step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .step-title { font-weight: 600; font-size: 13px; }
    .step-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .step-grid .full { grid-column: 1 / -1; }
    .step-actions { display: flex; gap: 6px; margin-top: 8px; }
    button {
      align-items: center; background: var(--vscode-button-secondaryBackground);
      border: 0; color: var(--vscode-button-secondaryForeground); cursor: pointer;
      display: inline-flex; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      justify-content: center; min-height: 26px; padding: 4px 10px;
    }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.icon { min-width: 28px; padding: 4px; }
    .toolbar { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 4px; }
    .model-hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px; min-height: 14px; }
    .section {
      border: 1px solid var(--vscode-widget-border, var(--vscode-sideBarSectionHeader-border, transparent));
      border-radius: 4px; margin: 0 0 12px; padding: 12px;
    }
    .inline { align-items: center; display: flex; gap: 8px; margin-bottom: 10px; }
    .inline input { min-height: auto; width: auto; }
    .loop-grid { display: grid; grid-template-columns: 1fr 1fr 120px; gap: 8px; }
    .loop-grid .full { grid-column: 1 / -1; }
  </style>
</head>
<body>
  <h1>Workflow Editor</h1>
  <label>
    <span class="label-text">Workflow name</span>
    <input id="wfName" type="text" placeholder="e.g. Research → Review → Write">
  </label>
  <label>
    <span class="label-text">Description (optional)</span>
    <input id="wfDesc" type="text" placeholder="What this workflow does">
  </label>

  <section class="section">
    <label class="inline">
      <input id="loopEnabled" type="checkbox">
      <span>Enable primary review loop</span>
    </label>
    <div class="loop-grid">
      <label><span class="label-text">Revise from step</span><select id="loopReviseFrom"></select></label>
      <label><span class="label-text">Review step</span><select id="loopReviewStep"></select></label>
      <label><span class="label-text">Max reviews</span><input id="loopMax" type="number" min="1" max="20" value="3"></label>
      <label class="full"><span class="label-text">Approval regex (optional)</span><input id="loopApproval" type="text" placeholder="Decision: APPROVED"></label>
    </div>
    <div class="hint">When the review is not approved, the workflow reruns from the selected revision step through the review step.</div>
    <div id="extraLoopsNote" class="hint" style="display:none"></div>
  </section>

  <div class="label-text" style="margin-bottom:6px">Steps</div>
  <div id="steps"></div>
  <button id="addStep" class="primary">+ Add Step</button>

  <div class="toolbar">
    <button id="cancelBtn">Cancel</button>
    <button id="saveBtn" class="primary">Save Workflow</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let providers = [];
    let skills = [];
    let workflowId = undefined;
    let reviewLoop = { enabled: false, reviseFromStepId: "", reviewStepId: "", maxIterations: 3, approvalPattern: "" };
    let extraLoops = [];
    const modelCache = {};

    const stepsEl = document.getElementById("steps");
    const wfName = document.getElementById("wfName");
    const wfDesc = document.getElementById("wfDesc");
    const loopEnabled = document.getElementById("loopEnabled");
    const loopReviseFrom = document.getElementById("loopReviseFrom");
    const loopReviewStep = document.getElementById("loopReviewStep");
    const loopMax = document.getElementById("loopMax");
    const loopApproval = document.getElementById("loopApproval");
    const extraLoopsNote = document.getElementById("extraLoopsNote");

    document.getElementById("addStep").addEventListener("click", () => addStep());
    document.getElementById("saveBtn").addEventListener("click", () => save());
    document.getElementById("cancelBtn").addEventListener("click", () => vscode.postMessage({ type: "ready" }));
    loopEnabled.addEventListener("change", syncLoopFromControls);
    loopReviseFrom.addEventListener("change", syncLoopFromControls);
    loopReviewStep.addEventListener("change", syncLoopFromControls);
    loopMax.addEventListener("input", syncLoopFromControls);
    loopApproval.addEventListener("input", syncLoopFromControls);

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "init") {
        providers = msg.payload.providers || [];
        skills = msg.payload.skills || [];
        const wf = msg.payload.workflow;
        if (wf) {
          workflowId = wf.id;
          wfName.value = wf.name || "";
          wfDesc.value = wf.description || "";
          const loops = wf.reviewLoops || [];
          reviewLoop = loops[0] || reviewLoop;
          extraLoops = loops.slice(1);
          (wf.steps || []).forEach((step) => addStep(step));
        }
        if (stepsEl.children.length === 0) addStep();
        applyLoopToControls();
        refreshLoopOptions();
        refreshExtraLoopsNote();
      } else if (msg.type === "models") {
        modelCache[msg.providerId] = msg.models || [];
        document.querySelectorAll(".step").forEach((el) => {
          if (el.dataset.providerId === msg.providerId) {
            populateModels(el, msg.models || []);
            const hint = el.querySelector(".model-hint");
            if (hint) hint.textContent = msg.error ? ("⚠ " + msg.error) : (msg.models.length + " models available");
          }
        });
      }
    });

    function addStep(existing) {
      const step = existing || { id: undefined, name: "", providerId: providers[0]?.id || "", model: "", skillDirectory: undefined, prompt: "" };
      const stepId = step.id || createClientStepId();
      const index = stepsEl.children.length;
      const el = document.createElement("div");
      el.className = "step";
      el.dataset.stepId = stepId;
      el.dataset.providerId = step.providerId || "";
      el.dataset.model = step.model || "";
      el.dataset.skill = step.skillDirectory || "";
      el.dataset.name = step.name || "";
      el.dataset.prompt = step.prompt || "";

      el.innerHTML = \`
        <div class="step-header">
          <span class="step-title">Step \${index + 1}</span>
          <div>
            <button class="icon" data-act="up" title="Move up">↑</button>
            <button class="icon" data-act="down" title="Move down">↓</button>
            <button class="icon" data-act="remove" title="Remove">✕</button>
          </div>
        </div>
        <div class="step-grid">
          <label class="full"><span class="label-text">Step name</span><input class="s-name" type="text" value="\${escapeAttr(step.name)}" placeholder="e.g. Researcher"></label>
          <label><span class="label-text">Provider</span><select class="s-provider"></select></label>
          <label><span class="label-text">Model</span><select class="s-model"></select></label>
          <label class="full"><span class="label-text">Skill (optional)</span><select class="s-skill"></select></label>
          <label class="full"><span class="label-text">Prompt — use {{task}} and {{previous}}</span><textarea class="s-prompt" placeholder="You are the researcher. Task: {{task}}\\nPrevious output: {{previous}}"></textarea></label>
          <label class="full"><span class="label-text">LaTeX template (optional)</span><input class="s-template" type="text" placeholder="Path to .tex template with {{BODY}} placeholder"></label>
          <label class="inline"><input class="s-execute" type="checkbox"><span>Execute generated code (Python)</span></label>
        </div>
        <div class="model-hint"></div>
        <div class="hint">Output of this step becomes {{previous}} for the next step.</div>
      \`;

      const providerSelect = el.querySelector(".s-provider");
      providers.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id; opt.textContent = p.name;
        providerSelect.append(opt);
      });
      providerSelect.value = step.providerId || providers[0]?.id || "";
      providerSelect.addEventListener("change", () => {
        el.dataset.providerId = providerSelect.value;
        el.dataset.model = "";
        loadModelsFor(providerSelect.value);
        refreshModelOptions(el, providerSelect.value);
      });

      const skillSelect = el.querySelector(".s-skill");
      const noneOpt = document.createElement("option");
      noneOpt.value = ""; noneOpt.textContent = "(no skill)";
      skillSelect.append(noneOpt);
      skills.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.directory; opt.textContent = s.name + " (" + s.scope + ")";
        skillSelect.append(opt);
      });
      skillSelect.value = step.skillDirectory || "";

      const nameInput = el.querySelector(".s-name");
      nameInput.addEventListener("input", () => { el.dataset.name = nameInput.value; refreshLoopOptions(); });
      const promptInput = el.querySelector(".s-prompt");
      promptInput.value = step.prompt || "";
      promptInput.addEventListener("input", () => { el.dataset.prompt = promptInput.value; });
      const templateInput = el.querySelector(".s-template");
      templateInput.value = step.templatePath || "";
      templateInput.addEventListener("input", () => { el.dataset.templatePath = templateInput.value; });
      const executeCheckbox = el.querySelector(".s-execute");
      executeCheckbox.checked = !!step.execute;
      executeCheckbox.addEventListener("change", () => { el.dataset.execute = executeCheckbox.checked ? "1" : ""; });
      const modelSelect = el.querySelector(".s-model");
      modelSelect.addEventListener("change", () => { el.dataset.model = modelSelect.value; });
      skillSelect.addEventListener("change", () => { el.dataset.skill = skillSelect.value; });

      el.querySelector('[data-act="up"]').addEventListener("click", () => moveStep(el, -1));
      el.querySelector('[data-act="down"]').addEventListener("click", () => moveStep(el, 1));
      el.querySelector('[data-act="remove"]').addEventListener("click", () => { el.remove(); renumber(); refreshLoopOptions(); });

      stepsEl.append(el);
      renumber();
      refreshLoopOptions();
      if (step.providerId) loadModelsFor(step.providerId);
      refreshModelOptions(el, step.providerId || providers[0]?.id || "", step.model);
    }

    function refreshModelOptions(el, providerId, preferred) {
      const models = modelCache[providerId] || [];
      const sel = el.querySelector(".s-model");
      const current = preferred ?? el.dataset.model ?? "";
      sel.innerHTML = "";
      if (models.length === 0) {
        const opt = document.createElement("option");
        opt.value = current; opt.textContent = current || "(enter model below)";
        sel.append(opt);
      } else {
        if (current && !models.includes(current)) {
          const opt = document.createElement("option");
          opt.value = current; opt.textContent = current + " (custom)";
          sel.append(opt);
        }
        models.forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m; opt.textContent = m;
          if (m === current) opt.selected = true;
          sel.append(opt);
        });
      }
      sel.value = current || sel.options[0]?.value || "";
      el.dataset.model = sel.value;
    }

    function populateModels(el, models) {
      refreshModelOptions(el, el.dataset.providerId);
    }

    function loadModelsFor(providerId) {
      if (modelCache[providerId]) return;
      vscode.postMessage({ type: "loadModels", providerId });
    }

    function moveStep(el, dir) {
      const nodes = Array.from(stepsEl.children);
      const i = nodes.indexOf(el);
      const j = i + dir;
      if (j < 0 || j >= nodes.length) return;
      if (dir < 0) stepsEl.insertBefore(el, nodes[j]);
      else stepsEl.insertBefore(el, nodes[j].nextSibling);
      renumber();
      refreshLoopOptions();
    }

    function renumber() {
      Array.from(stepsEl.children).forEach((el, i) => {
        el.querySelector(".step-title").textContent = "Step " + (i + 1);
      });
    }

    function applyLoopToControls() {
      loopEnabled.checked = !!reviewLoop.enabled;
      loopMax.value = String(reviewLoop.maxIterations || 3);
      loopApproval.value = reviewLoop.approvalPattern || "";
    }

    function syncLoopFromControls() {
      reviewLoop = {
        enabled: loopEnabled.checked,
        reviseFromStepId: loopReviseFrom.value,
        reviewStepId: loopReviewStep.value,
        maxIterations: Number(loopMax.value) || 3,
        approvalPattern: loopApproval.value
      };
    }

    function refreshExtraLoopsNote() {
      if (!extraLoopsNote) return;
      if (extraLoops.length > 0) {
        extraLoopsNote.style.display = "block";
        extraLoopsNote.textContent = "ℹ This workflow has " + extraLoops.length + " additional review loop(s) not shown here. They are preserved on save; edit them via the workflow config file.";
      } else {
        extraLoopsNote.style.display = "none";
      }
    }

    function refreshLoopOptions() {
      const currentReviseFrom = reviewLoop.reviseFromStepId || loopReviseFrom.value;
      const currentReviewStep = reviewLoop.reviewStepId || loopReviewStep.value;
      const stepOptions = Array.from(stepsEl.children).map((el, i) => ({
        id: el.dataset.stepId,
        label: "Step " + (i + 1) + ": " + ((el.dataset.name || el.querySelector(".s-name").value || "Untitled step").trim())
      }));

      fillStepSelect(loopReviseFrom, stepOptions, currentReviseFrom || stepOptions[0]?.id || "");
      fillStepSelect(loopReviewStep, stepOptions, currentReviewStep || stepOptions[stepOptions.length - 1]?.id || "");
      syncLoopFromControls();
    }

    function fillStepSelect(select, options, selectedId) {
      select.innerHTML = "";
      options.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.id;
        opt.textContent = option.label;
        select.append(opt);
      });
      select.value = options.some((option) => option.id === selectedId) ? selectedId : (options[0]?.id || "");
    }

    function save() {
      syncLoopFromControls();
      const steps = Array.from(stepsEl.children).map((el) => ({
        id: el.dataset.stepId || undefined,
        name: el.dataset.name || el.querySelector(".s-name").value,
        providerId: el.dataset.providerId,
        model: el.dataset.model || el.querySelector(".s-model").value,
        skillDirectory: el.dataset.skill || undefined,
        prompt: el.dataset.prompt ?? el.querySelector(".s-prompt").value,
        execute: el.dataset.execute === "1" || el.querySelector(".s-execute").checked,
        templatePath: el.dataset.templatePath ?? el.querySelector(".s-template").value || undefined
      }));
      const reviewLoops = reviewLoop.enabled ? [reviewLoop, ...extraLoops] : extraLoops;
      vscode.postMessage({
        type: "save",
        workflow: { id: workflowId, name: wfName.value, description: wfDesc.value, reviewLoops, steps }
      });
    }

    function escapeAttr(v) {
      return String(v || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    function createClientStepId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
      return "step-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    vscode.postMessage({ type: "ready" });
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
