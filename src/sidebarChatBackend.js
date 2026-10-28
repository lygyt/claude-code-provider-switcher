"use strict";

const vscode = require("vscode");
const { spawn } = require("node:child_process");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { randomUUID, createHash } = require("node:crypto");
const { resolveClaudeExecutable } = require("./claudeCli");
const { buildClaudeTerminalEnv, prepareSkillLaunchSelection } = require("./terminalLauncher");
const { authTypeRequiresToken } = require("./validation");
const { getConfig } = require("./vscodeUtils");

// On Windows, Claude's npm entry point is a .cmd shim, which cannot be
// spawned with shell:false. Resolve its adjacent native executable instead.
async function resolveSidebarExecutable() {
    let executable = await resolveClaudeExecutable();
    if (process.platform !== "win32") return executable;
    const candidates = [];
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, ".local", "bin", "claude.exe"));
    const located = await new Promise(resolve => execFile("where.exe", ["claude"], { windowsHide: true }, (error, stdout) => resolve(error ? [] : stdout.split(/\r?\n/).filter(Boolean))));
    for (const item of located) {
        if (/\.exe$/i.test(item)) candidates.push(item);
        if (/\.(?:cmd|bat)$/i.test(item)) candidates.push(path.join(path.dirname(item), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    }
    if (executable && /\.exe$/i.test(executable)) candidates.unshift(executable);
    return candidates.find(candidate => fs.existsSync(candidate));
}

// Claude's streaming CLI protocol keeps stdin open for permission requests.
// Reuse one process per conversation and configuration; stdin stays open after
// result messages so subsequent user turns share the same Claude session.
class SidebarChatBackend {
    constructor({ store, skillStore, onEvent }) {
        this.store = store;
        this.skillStore = skillStore;
        this.onEvent = onEvent;
        this.pending = new Map();
        this.child = undefined;
        this.starting = false;
        this.cancelled = false;
        this.activeTurn = false;
        this.processKey = undefined;
        this.sessionId = undefined;
        this.beginTurn = undefined;
        this.cancelTimer = undefined;
        this.stopping = undefined;
    }

    emit(event) { this.onEvent(event); }

    async send(text, options = {}) {
        if (this.starting || this.activeTurn) throw new Error("A Claude response is already running.");
        if (!text || !text.trim()) throw new Error("Enter a message first.");
        if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before running Claude Code.");
        this.starting = true;
        this.cancelled = false;
        try {
            const provider = await this.store.getActiveProvider();
            if (!provider) throw new Error("Select a provider first.");
            let token = await this.store.getToken(provider.id);
            if (authTypeRequiresToken(provider.authType) && !token?.trim()) {
                token = await vscode.window.showInputBox({ title: `${provider.name} API key or token`, password: true, ignoreFocusOut: true, validateInput: value => value.trim() ? undefined : "A key or token is required." });
                if (!token) throw new Error("A provider API key or token is required.");
                await this.store.setToken(provider.id, token.trim());
            }
            const [skills, activeSkill] = await Promise.all([this.skillStore.getInstalledSkills(), this.skillStore.getAutoUseSkill()]);
            const mode = getConfig().permissionMode;
            const activeEditor = vscode.window.activeTextEditor;
            const cwd = options.cwd || (activeEditor && vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!cwd) throw new Error("请先在 VS Code 中打开并信任一个文件夹，再开始 Claude Code 对话。");
            if (options.cwd && !vscode.workspace.getWorkspaceFolder(vscode.Uri.file(options.cwd))) {
                throw new Error("请先在 VS Code 中打开并信任该对话所属的工作区。");
            }
            const key = createHash("sha256").update(JSON.stringify({ provider, token, cwd, mode, skills: skills.map(s => s.directory), activeSkill: activeSkill?.directory })).digest("hex");
            if (this.cancelled) { this.emit({ type: "done" }); return; }
            if (this.child && this.processKey === key && options.sessionId && this.sessionId === options.sessionId && this.beginTurn) {
                this.beginTurn();
                this.write({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: this.sessionId });
                return;
            }
            if (!(await this.reset())) throw new Error("Claude Code 旧进程尚未退出，请稍后重试。");
            if (this.cancelled) { this.emit({ type: "done" }); return; }
            this.cancelled = false;
            this.emit({ type: "progress", message: "正在启动 Claude Code…" });
            const executable = await resolveSidebarExecutable();
            if (!executable) throw new Error("Claude Code CLI was not found. Install Claude Code and try again.");
            let selection = { kind: "none" };
            if (skills.length) {
                selection = await prepareSkillLaunchSelection({ kind: "skills", directories: skills.map(s => s.directory), autoUse: activeSkill ? { name: activeSkill.name, directory: activeSkill.directory, slashName: path.basename(activeSkill.directory) } : undefined });
            }
            if (this.cancelled) { this.emit({ type: "done" }); return; }
            const args = ["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--permission-prompt-tool", "stdio"];
            args.push("--permission-mode", mode === "fullAccess" ? "bypassPermissions" : "default");
            if (options.sessionId) args.push("--resume", options.sessionId);
            if (selection.kind === "skills") {
                for (const directory of selection.directories) args.push("--plugin-dir", directory);
                if (selection.autoUse) args.push("--append-system-prompt", `For this Claude Code session, automatically use the selected skill /${selection.autoUse.slashName} (${selection.autoUse.name}) when it fits the user's task. Treat this selected skill as the default working mode for relevant requests. Do not wait for the user to type the slash command before applying the skill's instructions.`);
            }
            const overrides = buildClaudeTerminalEnv(provider, token);
            const env = { ...process.env };
            for (const [key, value] of Object.entries(overrides)) {
                if (value == null) delete env[key]; else env[key] = value;
            }
            const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
            this.child = child;
            this.processKey = key;
            this.sessionId = options.sessionId;
            this.pending.clear();
            let stderr = "";
            let streamedText = false;
            let emittedText = false;
            let receivedResponse = false;
            let thinking = false;
            // CLI can emit the completed assistant block before content_block_stop.
            // Track each block separately so its full copy is not rendered twice.
            let turnId = randomUUID();
            let blockSerial = 0;
            let thinkingBlocks = new Map();
            let unacknowledgedThinking = [];
            const createThinkingBlock = index => {
                const block = { id: `${turnId}:${++blockSerial}`, text: "", ended: false };
                thinkingBlocks.set(index, block);
                unacknowledgedThinking.push(block);
                return block;
            };
            const appendThinking = (block, text) => {
                if (typeof text !== "string" || !text) return;
                block.text += text;
                this.emit({ type: "thinking", blockId: block.id, text });
            };
            const endThinking = block => {
                if (!block || block.ended) return;
                block.ended = true;
                this.emit({ type: "thinkingEnd", blockId: block.id });
            };
            const endThinkingBlocks = () => { for (const block of thinkingBlocks.values()) endThinking(block); };
            let lastProgress = "正在启动 Claude Code…";
            let waitingTimer, slowTimer;
            const progress = message => {
                if (message === lastProgress) return;
                lastProgress = message;
                this.emit({ type: "progress", message });
            };
            const startWaiting = () => {
                clearTimeout(waitingTimer); clearTimeout(slowTimer);
                receivedResponse = false; thinking = false;
                waitingTimer = setTimeout(() => {
                    if (!receivedResponse && this.child === child) progress(thinking ? "模型正在思考，等待回复…" : "正在等待模型回复…");
                }, 12000);
                slowTimer = setTimeout(() => {
                    if (!receivedResponse && this.child === child) progress(thinking ? "模型仍在思考，可继续等待或点击停止。" : "等待时间较长，请检查网络、Provider 和模型；也可点击停止。");
                }, 60000);
                waitingTimer.unref(); slowTimer.unref();
            };
            this.beginTurn = () => {
                this.activeTurn = true;
                this.pending.clear();
                turnId = randomUUID(); blockSerial = 0;
                thinkingBlocks = new Map(); unacknowledgedThinking = [];
                streamedText = false; emittedText = false;
                startWaiting();
                progress("正在等待模型回复…");
            };
            const markResponse = () => {
                receivedResponse = true;
                clearTimeout(waitingTimer); clearTimeout(slowTimer);
                progress("");
            };
            const lines = readline.createInterface({ input: child.stdout });
            // A launch failure can close stdin before the initial request is written.
            child.stdin.on("error", () => {});
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });
            lines.on("line", line => {
                let message;
                try { message = JSON.parse(line); } catch { return; }
                if (this.child !== child) return;
                if (message.session_id) { this.sessionId = message.session_id; this.emit({ type: "session", sessionId: message.session_id }); }
                if (!this.activeTurn) return;
                if (message.type === "system" && message.subtype === "api_retry") {
                    clearTimeout(waitingTimer); clearTimeout(slowTimer);
                    progress("模型请求失败，Claude Code 正在重试。请检查网络或 Provider 配置。");
                } else if (message.type === "control_request") {
                    const request = message.request || {};
                    if (request.subtype === "can_use_tool") {
                        markResponse();
                        this.pending.set(message.request_id, request);
                        this.emit({ type: "permission", requestId: message.request_id, name: request.tool_name, input: request.input, description: request.description, decisionReason: request.decision_reason });
                    } else {
                        this.write({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "Unsupported control request" } });
                    }
                } else if (message.type === "stream_event") {
                    const event = message.event || {};
                    if (event.type === "message_start") { endThinkingBlocks(); thinkingBlocks = new Map(); unacknowledgedThinking = []; streamedText = false; startWaiting(); }
                    if (!thinking && ((event.type === "content_block_start" && event.content_block?.type === "thinking") || (event.type === "content_block_delta" && event.delta?.type === "thinking_delta"))) {
                        thinking = true;
                        progress("模型正在思考…");
                    }
                    if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
                        const index = event.index ?? 0;
                        endThinking(thinkingBlocks.get(index));
                        appendThinking(createThinkingBlock(index), event.content_block.thinking);
                    }
                    if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
                        const index = event.index ?? 0;
                        appendThinking(thinkingBlocks.get(index) || createThinkingBlock(index), event.delta.thinking);
                    }
                    if (event.type === "content_block_stop") endThinking(thinkingBlocks.get(event.index ?? 0));
                    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                        markResponse();
                        streamedText = true;
                        if (event.delta.text) emittedText = true;
                        this.emit({ type: "text", text: event.delta.text || "" });
                    }
                } else if (message.type === "assistant") {
                    for (const block of message.message?.content || []) {
                        if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
                            const index = unacknowledgedThinking.findIndex(candidate => !candidate.text || block.thinking.startsWith(candidate.text));
                            if (index >= 0) {
                                const streamed = unacknowledgedThinking.splice(index, 1)[0];
                                appendThinking(streamed, block.thinking.slice(streamed.text.length));
                            } else {
                                const complete = { id: `${turnId}:${++blockSerial}`, text: "", ended: false };
                                appendThinking(complete, block.thinking);
                                endThinking(complete);
                            }
                        }
                        if (block.type === "text" && !streamedText) {
                            markResponse();
                            if (block.text) emittedText = true;
                            this.emit({ type: "text", text: block.text || "" });
                        }
                        if (block.type === "tool_use") { markResponse(); this.emit({ type: "tool", id: block.id, name: block.name, input: block.input }); }
                    }
                } else if (message.type === "user" && Array.isArray(message.message?.content)) {
                    for (const block of message.message.content) {
                        if (block.type === "tool_result" && block.tool_use_id) {
                            this.emit({ type: "toolResult", id: block.tool_use_id, content: block.content, is_error: !!block.is_error });
                            startWaiting();
                            progress("工具已执行，正在等待模型回复…");
                        }
                    }
                } else if (message.type === "result") {
                    endThinkingBlocks();
                    markResponse();
                    // Some CLI/provider combinations return only the final result.
                    // Display it when no assistant text was emitted, without
                    // duplicating a normal streamed response.
                    if (!this.cancelled && !message.is_error && !emittedText && typeof message.result === "string" && message.result) {
                        emittedText = true;
                        this.emit({ type: "text", text: message.result });
                    }
                    if (!this.cancelled) this.emit({ type: "result", result: message.result, is_error: message.is_error, subtype: message.subtype });
                    clearTimeout(this.cancelTimer); this.cancelTimer = undefined;
                    this.activeTurn = false;
                    this.pending.clear();
                    this.emit({ type: "done" });
                }
            });
            child.on("error", error => { if (this.child === child && this.activeTurn) this.emit({ type: "error", message: error.message }); });
            child.on("close", code => {
                clearTimeout(waitingTimer); clearTimeout(slowTimer);
                lines.close();
                if (this.child !== child) return;
                clearTimeout(this.cancelTimer); this.cancelTimer = undefined;
                endThinkingBlocks();
                this.child = undefined;
                this.processKey = undefined;
                this.beginTurn = undefined;
                this.pending.clear();
                if (!this.activeTurn) return;
                if (!this.cancelled) {
                    const safe = token ? stderr.split(token).join("[redacted]") : stderr;
                    this.emit({ type: "error", message: safe.trim().slice(-2000) || `Claude Code 未返回结果（退出码：${code ?? "未知"}）。请检查 Provider、模型及连接后重试。` });
                }
                this.activeTurn = false;
                this.emit({ type: "done" });
            });
            this.beginTurn();
            this.write({ type: "control_request", request_id: "initialize", request: { subtype: "initialize", hooks: null } });
            this.write({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: options.sessionId || "" });
        } finally {
            this.starting = false;
        }
    }

    write(message) {
        if (this.child && !this.child.stdin.destroyed && this.child.stdin.writable) this.child.stdin.write(JSON.stringify(message) + "\n");
    }

    respondPermission(requestId, allow, updatedInput) {
        const request = this.pending.get(requestId);
        if (!request) return;
        this.pending.delete(requestId);
        const response = allow ? { behavior: "allow", updatedInput: updatedInput || request.input } : { behavior: "deny", message: "Denied by user" };
        this.write({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });
    }

    cancel() {
        this.cancelled = true;
        if (this.child && this.activeTurn) {
            const child = this.child;
            this.write({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
            clearTimeout(this.cancelTimer);
            this.cancelTimer = setTimeout(() => { if (this.child === child && this.activeTurn) child.kill(); }, 5000);
            this.cancelTimer.unref();
        }
    }

    reset() {
        // Detach before killing: a late close from an old process must never
        // clear or signal completion for the next process.
        const old = this.child;
        clearTimeout(this.cancelTimer); this.cancelTimer = undefined;
        this.child = undefined;
        this.processKey = undefined;
        this.beginTurn = undefined;
        this.sessionId = undefined;
        this.activeTurn = false;
        this.pending.clear();
        if (!old) return this.stopping || Promise.resolve(true);
        const prior = this.stopping;
        const closing = new Promise(resolve => {
            let finished = false;
            const finish = ok => { if (finished) return; finished = true; clearTimeout(timer); resolve(ok); };
            const timer = setTimeout(() => finish(false), 5000);
            timer.unref();
            old.once("close", () => finish(true));
            try { old.kill(); } catch { finish(false); }
        });
        const pending = prior ? Promise.all([prior, closing]).then(values => values.every(Boolean)) : closing;
        this.stopping = pending;
        void pending.then(ok => {
            if (ok && this.stopping === pending) this.stopping = undefined;
        });
        old.once("close", () => {
            void pending.then(() => { if (this.stopping === pending) this.stopping = undefined; });
        });
        return pending;
    }

    dispose() { this.cancelled = true; this.reset(); }
}

module.exports = { SidebarChatBackend };
