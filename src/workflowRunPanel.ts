import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import {
  Workflow,
  WorkflowRunResult,
  WorkflowStepResult
} from "./types";
import { renderWorkflowReport } from "./workflowRunner";
import { showSafeError } from "./vscodeUtils";

interface PanelInitPayload {
  workflow: Workflow;
  task: string;
  providerName: string;
  startTime: number;
  loops: Array<{ name: string; reviseFromId: string; reviewStepId: string; maxIterations: number }>;
}

type PanelInboundMessage = { type: "ready" } | { type: "saveReport" } | { type: "copyReport" };

export class WorkflowRunPanel {
  private panel: vscode.WebviewPanel;
  private reportMarkdown: string = "";
  private reportPath: string | undefined;

  public constructor(
    private readonly workflow: Workflow,
    private readonly task: string,
    private readonly providerName: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "claudeCodeProviderSwitcher.workflowRun",
      `Running: ${workflow.name}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.iconPath = new vscode.ThemeIcon("play");
    this.panel.webview.html = createPanelHtml();
    this.panel.onDidDispose(() => this.panel.dispose());

    this.panel.webview.onDidReceiveMessage((message: PanelInboundMessage) => {
      void this.handleMessage(message).catch((error: unknown) =>
        showSafeError(error, "Workflow run panel action failed.")
      );
    });

    const loopConfigs = (workflow.reviewLoops ?? []).filter((loop) => loop.enabled);
    const init: PanelInitPayload = {
      workflow,
      task,
      providerName,
      startTime: Date.now(),
      loops: loopConfigs.map((loop) => ({
        name: loop.name ?? "review",
        reviseFromId: loop.reviseFromStepId,
        reviewStepId: loop.reviewStepId,
        maxIterations: loop.maxIterations
      }))
    };
    this.panel.webview.postMessage({ type: "init", payload: init });
  }

  public onStepCompleted(result: WorkflowStepResult, stepIndex: number, totalSteps: number): void {
    this.panel.webview.postMessage({
      type: "step",
      result,
      stepIndex,
      totalSteps,
      loopName: result.step.skillDirectory ? undefined : undefined
    });
  }

  public onFinished(result: WorkflowRunResult): void {
    this.reportMarkdown = renderWorkflowReport(result);
    const loops = result.reviewLoops ?? [];

    // Auto-save to disk
    this.saveReportToDisk(result).then(
      (savedPath) => {
        this.reportPath = savedPath;
        this.panel.webview.postMessage({ type: "finished", result, loops, reportPath: savedPath });
      },
      () => {
        this.panel.webview.postMessage({ type: "finished", result, loops });
      }
    );
  }

  private async saveReportToDisk(result: WorkflowRunResult): Promise<string> {
    const dir = path.join(os.homedir(), ".claude-code-provider-switcher", "runs");
    await fs.mkdir(dir, { recursive: true });
    const safeName = result.workflow.name.replace(/[<>:"/\\|?*\s]+/g, "-").replace(/-+/g, "-");
    const timestamp = new Date().toISOString().replace(/[:.]+/g, "-");
    const filePath = path.join(dir, `${safeName}-${timestamp}.md`);
    await fs.writeFile(filePath, this.reportMarkdown, "utf8");

    // Open the saved file in VS Code
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      // file open failed — report is still saved; user can navigate to it manually
    }

    return filePath;
  }

  private async handleMessage(message: PanelInboundMessage): Promise<void> {
    if (message.type === "ready") return;

    if (message.type === "saveReport" && this.reportMarkdown) {
      try {
        if (this.reportPath) {
          await fs.writeFile(this.reportPath, this.reportMarkdown, "utf8");
          await vscode.window.showInformationMessage(`Report saved: ${this.reportPath}`);
        } else {
          const savedPath = await this.saveReportToDisk({
            workflow: this.workflow,
            task: this.task,
            steps: [],
            finalOutput: "",
            succeeded: true
          });
          this.reportPath = savedPath;
          await vscode.window.showInformationMessage(`Report saved: ${savedPath}`);
        }
      } catch (error) {
        showSafeError(error, "Failed to save workflow run report.");
      }
      return;
    }

    if (message.type === "copyReport" && this.reportMarkdown) {
      await vscode.env.clipboard.writeText(this.reportMarkdown);
      await vscode.window.showInformationMessage("Report copied to clipboard.");
    }
  }
}

function createPanelHtml(): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Run</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px; padding: 16px; line-height: 1.5;
    }

    .header { margin-bottom: 16px; }
    .header h1 { font-size: 15px; font-weight: 600; }
    .header .task { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
    .header .meta { display: flex; gap: 12px; font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }

    .pipeline { position: relative; margin-left: 12px; }

    .step {
      display: flex; gap: 10px; padding: 8px 0;
      border-left: 3px solid transparent; padding-left: 10px; margin-bottom: 1px;
      transition: border-color 0.3s, background 0.3s;
    }
    .step.pending { border-left-color: var(--vscode-descriptionForeground, #888); opacity: 0.55; }
    .step.running { border-left-color: var(--vscode-textLink-foreground, #3794ff); background: rgba(55,148,255,0.06); }
    .step.done    { border-left-color: var(--vscode-charts-green, #4caf50); }
    .step.error   { border-left-color: var(--vscode-errorForeground, #f44336); background: rgba(244,67,54,0.06); }

    .step-icon { width: 18px; font-size: 13px; flex-shrink: 0; text-align: center; }
    .step-body { flex: 1; min-width: 0; }
    .step-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin-bottom: 2px; }
    .step-name { font-weight: 600; }
    .badge {
      font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
      text-transform: uppercase;
    }
    .badge-pro { background: rgba(212,175,55,0.2); color: #d4af37; border: 1px solid rgba(212,175,55,0.4); }
    .badge-flash { background: rgba(160,160,160,0.2); color: #a0a0a0; border: 1px solid rgba(160,160,160,0.4); }
    .badge-skill { background: rgba(128,128,255,0.15); color: #8888ff; border: 1px solid rgba(128,128,255,0.35); }
    .badge-iter { background: rgba(255,152,0,0.15); color: #ff9800; border: 1px solid rgba(255,152,0,0.35); }
    .step-time { font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: auto; }

    .step-detail { display: none; margin-top: 6px; }
    .step.show-detail .step-detail { display: block; }
    .step-detail summary {
      cursor: pointer; font-size: 11px; color: var(--vscode-textLink-foreground);
      user-select: none; margin-bottom: 4px;
    }
    .step-detail pre {
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px; padding: 8px 10px; font-size: 11px;
      max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
      font-family: var(--vscode-editor-font-family);
    }
    .step-detail summary { padding: 2px 0; }

    .loop-group {
      border: 2px dashed var(--vscode-widget-border);
      border-radius: 6px; margin: 4px 0 8px 0;
    }
    .loop-header {
      background: var(--vscode-toolbar-hoverBackground);
      font-size: 11px; font-weight: 600; padding: 4px 10px;
      display: flex; align-items: center; gap: 8px;
    }
    .loop-header .loop-icon { font-size: 15px; }
    .loop-body { padding: 0 4px; }

    .footer {
      margin-top: 16px; padding: 12px; border-radius: 6px;
      background: var(--vscode-textBlockQuote-background);
      text-align: center;
    }
    .footer .status { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
    .footer .stats { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
    .footer .actions { display: flex; gap: 8px; justify-content: center; }

    button {
      align-items: center; background: var(--vscode-button-secondaryBackground);
      border: 0; color: var(--vscode-button-secondaryForeground); cursor: pointer;
      display: inline-flex; font-family: var(--vscode-font-family); font-size: 12px;
      justify-content: center; min-height: 26px; padding: 4px 12px; border-radius: 3px;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }

    @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
    .running .step-icon { animation: pulse 0.9s ease-in-out infinite; }
  </style>
</head>
<body>
  <div class="header">
    <h1 id="wfName">🏃 Workflow</h1>
    <div class="task" id="taskLine"></div>
    <div class="meta"><span id="providerTag"></span> <span id="timer">⏱ 0:00</span></div>
  </div>
  <div class="pipeline" id="pipeline"></div>
  <div class="footer" id="footer" style="display:none">
    <div class="status" id="finStatus"></div>
    <div class="stats" id="finStats"></div>
    <div class="actions"><button id="btnSave">💾 Save Report</button><button id="btnCopy">📋 Copy</button></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let workflow, task, startTime, loops;
    let timerId = null;
    let stepIndex = 0;
    let reportPath = undefined;
    const stepCards = new Map(); // key: stepId-iter → DOM element

    const pipelineEl = document.getElementById("pipeline");
    const footerEl = document.getElementById("footer");
    const wfEl = document.getElementById("wfName");
    const taskEl = document.getElementById("taskLine");
    const provEl = document.getElementById("providerTag");
    const timerEl = document.getElementById("timer");
    const finStatus = document.getElementById("finStatus");
    const finStats = document.getElementById("finStats");

    document.getElementById("btnSave").addEventListener("click", () => vscode.postMessage({ type: "saveReport" }));
    document.getElementById("btnCopy").addEventListener("click", () => vscode.postMessage({ type: "copyReport" }));

    function startTimer(start) {
      startTime = start || Date.now();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        const s = Math.floor((Date.now() - startTime) / 1000);
        timerEl.textContent = "⏱ " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      }, 1000);
    }

    function iconForStatus(s) {
      if (s === "done") return "✅";
      if (s === "running") return "⏳";
      if (s === "error") return "✕";
      return "⬜";
    }

    function renderInit(payload) {
      const wf = payload.workflow;
      workflow = wf; task = payload.task;
      wfEl.textContent = "🏃 " + wf.name;
      taskEl.textContent = payload.task;
      provEl.textContent = "Provider: " + (payload.providerName || "default");
      loops = payload.loops || [];
      startTimer(payload.startTime);

      // Build loop step-set for quick lookup
      const loopById = new Map();
      const stepInLoop = new Map(); // stepId → loop info
      for (const loop of loops) {
        const stepIds = wf.steps.map(s => s.id);
        const reviseIdx = stepIds.indexOf(loop.reviseFromId);
        const reviewIdx = stepIds.indexOf(loop.reviewStepId);
        if (reviseIdx >= 0 && reviewIdx >= 0 && reviseIdx < reviewIdx) {
          for (let i = reviseIdx; i <= reviewIdx; i++) {
            stepInLoop.set(stepIds[i], { ...loop, reviseFromId: loop.reviseFromId, reviewStepId: loop.reviewStepId });
          }
        }
      }

      let openLoop = null;

      for (let i = 0; i < wf.steps.length; i++) {
        const step = wf.steps[i];
        const sl = stepInLoop.get(step.id);

        // Close previous loop group if stepping out
        if (openLoop && (!sl || sl.reviseFromId !== openLoop.reviseFromId)) {
          pipelineEl.appendChild(closeLoopGroup(openLoop));
          openLoop = null;
        }

        // Open a new loop group
        if (sl && (!openLoop || openLoop.reviseFromId !== sl.reviseFromId)) {
          const loopEl = openLoopGroup(sl);
          pipelineEl.appendChild(loopEl);
          openLoop = sl;
        }

        const card = makeStepCard(step, 0);
        if (openLoop) {
          const body = pipelineEl.querySelector(".loop-body[data-loop-id=" + JSON.stringify(openLoop.reviseFromId) + "]");
          if (body) body.appendChild(card);
        } else {
          pipelineEl.appendChild(card);
        }
        stepCards.set(step.id + "-0", card);
      }

      if (openLoop) pipelineEl.appendChild(closeLoopGroup(openLoop));
    }

    function openLoopGroup(loopInfo) {
      const el = document.createElement("div");
      el.className = "loop-group";
      el.innerHTML =
        '<div class="loop-header"><span class="loop-icon">⟳</span> ' +
        escapeHtml(loopInfo.name) + " · max " + loopInfo.maxIterations + " passes</div>" +
        '<div class="loop-body" data-loop-id="' + escapeAttr(loopInfo.reviseFromId) + '"></div>';
      return el;
    }

    function closeLoopGroup(loopInfo) {
      const el = document.createElement("div");
      el.style.display = "none"; return el;
    }

    function makeStepCard(step, loopIteration) {
      const el = document.createElement("div");
      el.className = "step pending";
      const skill = step.skillDirectory ? step.skillDirectory.split(/[\\\\/]/).pop() : null;
      const iterTag = loopIteration > 0 ? (' <span class="badge badge-iter">iter ' + loopIteration + '</span>') : "";
      const modelBadge = (step.model || "").includes("flash")
        ? '<span class="badge badge-flash">flash</span>'
        : '<span class="badge badge-pro">pro</span>';
      const execBadge = step.execute ? ' <span class="badge badge-skill">exec</span>' : "";
      const latexBadge = step.templatePath ? ' <span class="badge badge-skill">latex</span>' : "";
      el.innerHTML =
        '<div class="step-icon">' + iconForStatus("pending") + '</div>' +
        '<div class="step-body">' +
          '<div class="step-header">' +
            '<span class="step-name">' + escapeHtml(step.name) + '</span>' +
            modelBadge + execBadge + latexBadge +
            (skill ? ' <span class="badge badge-skill">' + escapeHtml(skill) + '</span>' : '') +
            iterTag +
            '<span class="step-time"></span>' +
          '</div>' +
          '<div class="step-detail">' +
            '<details><summary>Show output</summary><pre class="out"></pre></details>' +
            '<details><summary>Show prompt sent</summary><pre class="prompt"></pre></details>' +
          '</div>' +
        '</div>';
      el.dataset.stepId = step.id;
      el.dataset.iteration = String(loopIteration || 0);
      return el;
    }

    function updateStepCard(step, stepResult, totalSteps) {
      const iter = stepResult.loopIteration || 1;
      const key = step.id + "-" + ((iter > 1 || stepIndex === 0) ? iter : 0);
      let card = stepCards.get(key);

      // On first pass (iter=1), replace the placeholder (-0)
      if (!card) {
        const placeholder = stepCards.get(step.id + "-0");
        if (placeholder && iter === 1) {
          card = placeholder;
          stepCards.delete(step.id + "-0");
          stepCards.set(key, card);
        }
      }

      if (!card) {
        // New card for higher iteration — insert inside the matching loop body
        card = makeStepCard(step, iter);
        const loopBody = document.querySelector(".loop-body[data-loop-id]");
        if (loopBody) loopBody.appendChild(card);
        else pipelineEl.appendChild(card);
        stepCards.set(key, card);
      }

      card.className = stepResult.error ? "step error" : "step done";
      card.querySelector(".step-icon").textContent = iconForStatus(stepResult.error ? "error" : "done");
      card.querySelector(".step-time").textContent = "✓";
      card.classList.add("show-detail");

      const preOut = card.querySelector(".out");
      if (preOut) preOut.textContent = stepResult.error ? ("ERROR: " + stepResult.error) : (stepResult.output || "(empty)");
      const prePrompt = card.querySelector(".prompt");
      if (prePrompt) prePrompt.textContent = stepResult.input || "";

      // Auto-scroll to latest
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "init") {
        renderInit(msg.payload);
      } else if (msg.type === "step") {
        updateStepCard(msg.result.step, msg.result, msg.totalSteps);
        stepIndex = msg.stepIndex;
      } else if (msg.type === "finished") {
        if (timerId) clearInterval(timerId);
        const result = msg.result;
        const loops = msg.loops || [];
        reportPath = msg.reportPath;

        // Remove any remaining "running" animations
        document.querySelectorAll(".step.running").forEach(el => el.classList.remove("running"));

        const s = result.succeeded;
        const allApproved = loops.length > 0 && loops.every(l => l.approved);
        const anyExhausted = loops.some(l => l.exhausted);
        const totalSteps = result.steps.length;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const elapsedStr = Math.floor(elapsed / 60) + "m " + (elapsed % 60) + "s";

        let statusText = s ? (allApproved ? "✅ All reviews approved" : anyExhausted ? "⚠️ Loop limit reached" : "✅ Completed") : "❌ Failed";
        finStatus.textContent = statusText;
        finStats.textContent = totalSteps + " steps · " + elapsedStr;
        footerEl.style.display = "block";
        footerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });

    function escapeHtml(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
    function escapeAttr(v) { return String(v || "").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  return nonce;
}
