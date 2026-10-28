'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadClaudeConversations } = require('./conversationHistory');
const { SidebarChatBackend } = require('./sidebarChatBackend');
const { getPromptSettings, applyAutomaticPrompt } = require('./promptTemplate');
const { describeTool } = require('./toolPresentation');

class SidebarChatView {
  constructor(store, skillStore, statusBar, historyProvider) {
    this.store = store; this.statusBar = statusBar; this.historyProvider = historyProvider;
    this.messages = []; this.sessionId = undefined; this.sessionCwd = undefined; this.busy = false; this.progress = ''; this.permission = undefined; this.permissionQueue = []; this.conversations = []; this.refreshVersion = 0; this.streamRefreshTimer = undefined;
    this.backend = new SidebarChatBackend({ store, skillStore, onEvent: event => this.onEvent(event) });
  }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html();
    view.webview.onDidReceiveMessage(message => { void this.handle(message).catch(error => this.report(error)); });
  }
  dispose() { this.clearStreamRefresh(); this.backend.dispose(); }
  clearStreamRefresh() { if (this.streamRefreshTimer) clearTimeout(this.streamRefreshTimer); this.streamRefreshTimer = undefined; }
  scheduleStreamRefresh() {
    if (this.streamRefreshTimer) return;
    this.streamRefreshTimer = setTimeout(() => { this.streamRefreshTimer = undefined; void this.refresh(); }, 60);
  }
  async showPromptSettings() {
    await this.open();
    await this.view?.webview.postMessage({ type: 'showPromptSettings' });
  }
  async open(sessionId) {
    if (sessionId && sessionId !== this.sessionId) {
      if (this.busy) { vscode.window.showWarningMessage('请先停止当前回复，再切换对话。'); return; }
      const found = (await loadClaudeConversations()).find(item => item.sessionId === sessionId);
      if (!found) { vscode.window.showWarningMessage('找不到该会话，请刷新历史记录。'); return; }
      const transcript = await readTranscript(found.filePath);
      if (transcript.cwd && !isWorkspacePath(transcript.cwd)) {
        vscode.window.showWarningMessage('该对话属于其他工作区。请先在 VS Code 中打开该工作区，再恢复对话。'); return;
      }
      this.backend.reset();
      this.messages = transcript.messages; this.sessionCwd = transcript.cwd; this.sessionId = sessionId; this.permission = undefined; this.permissionQueue = [];
    }
    await vscode.commands.executeCommand('workbench.view.extension.claudeCodeProviderSwitcher');
    await vscode.commands.executeCommand('claudeCodeProviderSwitcher.chat.focus');
    await this.refresh();
  }
  async refresh() {
    if (!this.view) return;
    const version = ++this.refreshVersion;
    const providers = await this.store.getProviders();
    const active = await this.store.getActiveProviderId();
    if (version !== this.refreshVersion) return;
    const settings = getPromptSettings(vscode);
    const messages = this.messages.map(message => message.role === 'tool' ? { ...message, presentation: describeTool(message.name, message.input) } : message);
    await this.view.webview.postMessage({ type: 'state', messages, busy: this.busy, progress: this.progress, permission: this.permission,
      sessionId: this.sessionId, providers: providers.map(p => ({ id: p.id, name: p.name })), active, settings,
      model: providers.find(p => p.id === active)?.model || '',
      conversations: this.conversations.map(({ sessionId, title, projectName, updatedAt }) => ({ sessionId, title, projectName, updatedAt })) });
  }
  async refreshHistory() {
    const all = await loadClaudeConversations();
    this.conversations = all.filter(item => !item.cwd || isWorkspacePath(item.cwd));
  }
  async handle(message) {
    switch (message.type) {
      case 'ready': await this.refreshHistory(); await this.refresh(); break;
      case 'send': {
        if (this.busy || typeof message.text !== 'string' || !message.text.trim()) return;
        const text = applyAutomaticPrompt(message.text.trim(), getPromptSettings(vscode));
        this.messages.push({ role: 'user', text }); this.busy = true; this.progress = ''; this.permission = undefined;
        await this.refresh();
        try {
          this.sessionCwd ||= currentWorkspacePath();
          await this.backend.send(text, { sessionId: this.sessionId, cwd: this.sessionCwd });
        }
        catch (error) { this.report(error); this.busy = false; this.progress = ''; await this.refresh(); }
        break;
      }
      case 'cancel': this.backend.cancel(); break;
      case 'permission': if (this.permission?.requestId !== message.requestId) return; this.backend.respondPermission(message.requestId, !!message.allow, message.updatedInput); this.permission = this.permissionQueue.shift(); await this.refresh(); break;
      case 'new':
        if (this.busy) { vscode.window.showWarningMessage('请先停止当前回复。'); return; }
        this.backend.reset();
        this.messages = []; this.sessionId = undefined; this.sessionCwd = undefined; this.progress = ''; this.permission = undefined; this.permissionQueue = []; await this.refresh(); break;
      case 'provider':
        if (this.busy) { await this.refresh(); return; }
        if (!(await this.store.getProviders()).some(p => p.id === message.id)) return;
        if ((await this.store.getActiveProviderId()) !== message.id) {
          await this.store.setActiveProviderId(message.id);
          this.backend.reset();
        }
        await this.statusBar.refresh(); await this.refresh(); break;
      case 'savePrompt': {
        const config = vscode.workspace.getConfiguration('claudeCodeProviderSwitcher');
        const target = key => config.inspect(key)?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update('promptTemplate', String(message.text || ''), target('promptTemplate'));
        await config.update('promptPlacement', ['off','prepend','append'].includes(message.placement) ? message.placement : 'off', target('promptPlacement'));
        await this.refresh(); break;
      }
      case 'history': await this.refreshHistory(); await this.refresh(); break;
      case 'settingsMenu': await vscode.commands.executeCommand('claudeCodeProviderSwitcher.openSettingsMenu'); break;
      case 'selectModel': if (!this.busy) await vscode.commands.executeCommand('claudeCodeProviderSwitcher.selectModel'); break;
      case 'openHistory': if (typeof message.sessionId === 'string') await this.open(message.sessionId); break;
      case 'terminal': await vscode.commands.executeCommand('claudeCodeProviderSwitcher.launchTerminal'); break;
      case 'copy': if (typeof message.text === 'string') await vscode.env.clipboard.writeText(message.text); break;
      case 'openLink': {
        try { const uri = vscode.Uri.parse(message.url); if (uri.scheme === 'https' || uri.scheme === 'http') await vscode.env.openExternal(uri); } catch { /* Ignore invalid links. */ }
        break;
      }
    }
  }
  onEvent(event) {
    if (event.type === 'session') {
      if (this.sessionId === event.sessionId) return;
      this.sessionId = event.sessionId;
    }
    else if (event.type === 'progress') this.progress = event.message || '';
    else if (event.type === 'thinking') {
      let item = [...this.messages].reverse().find(message => message.role === 'thinking' && message.id === event.blockId);
      if (!item) { item = { role: 'thinking', id: event.blockId, text: '', finished: false }; this.messages.push(item); }
      item.text += event.text || '';
    } else if (event.type === 'thinkingEnd') {
      const item = [...this.messages].reverse().find(message => message.role === 'thinking' && message.id === event.blockId);
      if (item) item.finished = true;
    }
    else if (event.type === 'text') {
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'assistant' && !last.finished) last.text += event.text;
      else this.messages.push({ role: 'assistant', text: event.text, finished: false });
    } else if (event.type === 'tool') {
      const last = this.messages[this.messages.length - 1]; if (last?.role === 'assistant') last.finished = true;
      this.messages.push({ role: 'tool', id: event.id, name: event.name, input: event.input, text: event.name + (event.input ? '\n' + JSON.stringify(event.input, null, 2) : '') });
    } else if (event.type === 'toolResult') {
      const item = [...this.messages].reverse().find(message => message.role === 'tool' && message.id && message.id === event.id);
      if (item) { item.result = event.content; item.isError = !!event.is_error; }
    } else if (event.type === 'permission') { const request = { requestId: event.requestId, name: event.name, input: event.input }; if (this.permission) this.permissionQueue.push(request); else this.permission = request; }
    else if (event.type === 'result' && event.is_error) this.messages.push({ role: 'error', text: event.result || event.subtype || '请求失败' });
    else if (event.type === 'error') this.messages.push({ role: 'error', text: event.message });
    else if (event.type === 'done') { this.busy = false; this.progress = ''; this.permission = undefined; this.permissionQueue = []; for (const item of this.messages) if (item.role === 'thinking') item.finished = true; this.historyProvider.refresh(); void this.refreshHistory().then(() => this.refresh()).catch(error => this.report(error)); }
    if (event.type === 'text' || event.type === 'thinking') this.scheduleStreamRefresh();
    else { this.clearStreamRefresh(); void this.refresh(); }
  }
  report(error) { this.messages.push({ role: 'error', text: error instanceof Error ? error.message : String(error) }); void this.refresh(); }
}
function currentWorkspacePath() {
  const editor = vscode.window.activeTextEditor;
  return (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function isWorkspacePath(candidate) {
  return (vscode.workspace.workspaceFolders || []).some(folder => {
    const relative = path.relative(path.resolve(folder.uri.fsPath), path.resolve(candidate));
    return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  });
}
async function readTranscript(file) {
  const result = []; let cwd; const tools = new Map();
  for (const line of (await fs.readFile(file, 'utf8')).split(/\r?\n/)) {
    try {
      const record = JSON.parse(line); if (!cwd && typeof record.cwd === 'string' && path.isAbsolute(record.cwd)) cwd = record.cwd;
      if (!['user','assistant'].includes(record.type) || record.isMeta || record.isSidechain) continue;
      const content = record.message?.content;
      if (typeof content === 'string') {
        if (content) result.push({ role: record.type, text: content, finished: true });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'thinking' && record.type === 'assistant' && typeof part.thinking === 'string' && part.thinking) result.push({ role: 'thinking', id: `history-${path.basename(file)}-${result.length}`, text: part.thinking, finished: true });
          else if (part.type === 'text' && typeof part.text === 'string' && part.text) result.push({ role: record.type, text: part.text, finished: true });
          else if (part.type === 'tool_use' && record.type === 'assistant' && !tools.has(part.id)) {
            const item = { role: 'tool', id: part.id, name: part.name, input: part.input, text: part.name + (part.input ? '\n' + JSON.stringify(part.input, null, 2) : '') };
            result.push(item); if (part.id) tools.set(part.id, item);
          } else if (part.type === 'tool_result' && record.type === 'user') {
            const item = tools.get(part.tool_use_id);
            if (item) { item.result = part.content; item.isError = !!part.is_error; }
          }
        }
      }
    } catch { /* Ignore malformed historical records. */ }
  }
  return { messages: result, cwd };
}
function html() {
  const nonce = require('node:crypto').randomBytes(16).toString('hex');
  return String.raw`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">
  *{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:13px var(--vscode-font-family)}button,select,textarea{font:inherit;color:inherit}button,select{cursor:pointer}button{border:0;background:transparent;padding:6px;border-radius:5px}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:1px solid var(--vscode-focusBorder)}.app{height:100vh;display:flex;flex-direction:column}.bar,.bottom{display:flex;align-items:center;gap:4px;padding:7px}.bar{border-bottom:1px solid var(--vscode-panel-border)}.bar strong{flex:1}.bar button{font-size:16px}.scroll{flex:1;overflow:auto;padding:8px 12px}.empty{height:100%;display:grid;place-items:center;text-align:center;color:var(--vscode-descriptionForeground)}.message{margin:12px 0;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}.message.user{background:var(--vscode-input-background);border-radius:12px;padding:10px}.message.tool{color:var(--vscode-descriptionForeground);font-size:12px;border-left:2px solid var(--vscode-panel-border);padding-left:8px;max-height:180px;overflow:auto}.message.error{color:var(--vscode-errorForeground)}.message pre{position:relative;white-space:pre;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:10px;border-radius:6px}.message pre button{position:absolute;right:4px;top:2px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);font-size:11px}.message code{font-family:var(--vscode-editor-font-family,monospace)}.message a{color:var(--vscode-textLink-foreground);cursor:pointer}.message h1,.message h2,.message h3{margin:10px 0 4px;font-size:1.1em}.label{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px}.compose{margin:8px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:12px;background:var(--vscode-input-background)}textarea{width:100%;resize:vertical;border:0;background:transparent;padding:10px;min-height:70px;max-height:35vh;outline:none}.bottom{padding:4px 8px}.bottom select{flex:1;min-width:0;background:transparent;border:0}#model{max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground)}.send{background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:6px 10px}.send:hover{background:var(--vscode-button-hoverBackground)}.permission{margin:8px;padding:10px;border:1px solid var(--vscode-focusBorder);border-radius:8px}.permission pre{max-height:120px;overflow:auto;white-space:pre-wrap}.settings{margin:8px;padding:10px;border:1px solid var(--vscode-panel-border);border-radius:8px}.settings textarea{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);margin:6px 0}.settings select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);padding:5px}.muted{color:var(--vscode-descriptionForeground);font-size:11px}.history-list{padding:8px 12px 2px}.history-heading{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:4px}.history-row{display:flex;width:100%;text-align:left;gap:8px;align-items:center;padding:6px 2px}.history-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-time{color:var(--vscode-descriptionForeground);font-size:11px;white-space:nowrap}.history-more{color:var(--vscode-descriptionForeground);font-size:11px;padding-left:2px}
  
  /* Compact tool rows and a calmer, editor-native conversation surface. */
  .bar{padding:10px 14px;gap:6px;background:var(--vscode-sideBar-background)}
  .bar strong{font-weight:650;letter-spacing:.01em}.bar button{color:var(--vscode-descriptionForeground)}
  .scroll{padding:6px 14px 18px;min-height:0;scrollbar-width:thin}.history-list{padding:8px 0 12px}
  .message{margin:18px 0;line-height:1.65}.message.user{margin-left:22px;padding:12px 14px;border-radius:14px 14px 4px 14px;background:var(--vscode-textBlockQuote-background,var(--vscode-input-background));border:1px solid var(--vscode-widget-border,transparent)}
  .message.assistant{padding:0 2px}.message.assistant .label{font-weight:600;color:var(--vscode-foreground);margin-bottom:7px}.message.user .label{color:var(--vscode-descriptionForeground)}
  .message.error{border-left:2px solid var(--vscode-errorForeground);padding:8px 12px;background:var(--vscode-inputValidation-errorBackground)}
  .tool-card{margin:5px 0;border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px;background:var(--vscode-editor-background);font-size:12px;overflow:hidden}
  .tool-card summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:9px 10px;min-width:0;color:var(--vscode-descriptionForeground)}
  .tool-card summary::-webkit-details-marker{display:none}.tool-card summary:hover{background:var(--vscode-list-hoverBackground)}
  .tool-icon{display:grid;place-items:center;width:20px;height:20px;flex:none;border-radius:5px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:11px}
  .tool-title{color:var(--vscode-foreground);font-weight:600;white-space:nowrap}.tool-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .tool-status{white-space:nowrap;font-size:11px}.tool-status.failed{color:var(--vscode-errorForeground)}.tool-chevron{font-size:12px;transition:transform .12s}.tool-card[open] .tool-chevron{transform:rotate(90deg)}
  .tool-body{border-top:1px solid var(--vscode-panel-border);padding:10px;color:var(--vscode-foreground);overflow:auto}.tool-section-title{font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0 6px}.tool-body pre{margin:0 0 10px;padding:10px;border-radius:6px;background:var(--vscode-textCodeBlock-background);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--vscode-editor-font-family,monospace);max-height:240px}
  .compose{margin:8px 12px 12px;border-radius:14px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));box-shadow:0 2px 8px #0001}.compose:focus-within{border-color:var(--vscode-focusBorder)}.compose textarea{min-height:72px;resize:vertical;line-height:1.5}.bottom{gap:4px;padding:4px 8px 8px}.bottom select{max-width:30%}#model{flex:1;text-align:left;max-width:none}.send{border-radius:8px;font-weight:600}
  .message pre{padding:12px;margin:10px 0;border:1px solid var(--vscode-panel-border)}.message pre code{display:block;padding-top:20px}.message blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding-left:12px;margin:8px 0;color:var(--vscode-descriptionForeground)}.message ul,.message ol{padding-left:22px;margin:6px 0}.message li{padding:1px 0}.message p{margin:6px 0}
  .activity{margin:14px 2px;color:var(--vscode-descriptionForeground);font-size:12px}
  .thinking-card{margin:12px 0;border-left:2px solid var(--vscode-focusBorder);padding:0 0 0 10px;color:var(--vscode-descriptionForeground);font-size:12px}
  .thinking-card summary{cursor:pointer;padding:5px 0;font-weight:600}.thinking-card .thinking-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;padding:4px 0 8px;max-height:260px;overflow:auto}
  </style></head><body><div class="app"><div class="bar"><strong>Claude Code</strong><button id="history" title="对话历史">◷</button><button id="settingsButton" title="设置">⚙</button><button id="new" title="新建对话">✎</button></div><div class="scroll" id="scroll"><div class="history-list" id="historyList" hidden></div><div id="messages"></div></div><div id="permission"></div><div class="settings" id="settings" hidden><label for="template">自定义提示词</label><textarea id="template" placeholder="输入要重复使用的提示词"></textarea><div class="muted">Ctrl+Alt+P（Mac：⌘+Option+P）插入到光标处</div><p><label for="placement">发送时自动插入 </label><select id="placement"><option value="off">关闭</option><option value="prepend">头部</option><option value="append">尾部</option></select></p><button class="send" id="save">保存</button> <button id="closeSettings">关闭</button></div><div class="compose"><textarea id="input" placeholder="给 Claude 发送消息…（Enter 发送，Shift+Enter 换行）"></textarea><div class="bottom"><button id="insert" title="插入自定义提示词 (Ctrl+Alt+P)">＋</button><select id="provider" aria-label="Provider"></select><button id="model" title="选择模型">模型</button><button id="terminal" title="在终端中打开 Claude Code">⌘</button><button class="send" id="send">发送</button><button class="send" id="stop" hidden>停止</button></div></div></div><script nonce="${nonce}">
  const vscode=acquireVsCodeApi(), $=id=>document.getElementById(id); let state={settings:{text:'',placement:'off'}}, settingsOpen=false, renderedPermissionId=null, historyVisible=true, historyExpanded=false, followNextSend=false;
  function inline(parent, text) {
    const pattern=/(\x60[^\x60\n]+\x60|\x2a\x2a[^\n]+?\x2a\x2a|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
    let last=0, match;
    while((match=pattern.exec(text))){parent.appendChild(document.createTextNode(text.slice(last,match.index)));const part=match[0];let el;
      if(part.charCodeAt(0)===96){el=document.createElement('code');el.textContent=part.slice(1,-1)}
      else if(part.startsWith('**')){el=document.createElement('strong');el.textContent=part.slice(2,-2)}
      else{const split=part.indexOf('](');el=document.createElement('a');el.textContent=part.slice(1,split);const url=part.slice(split+2,-1);el.href=url;el.onclick=e=>{e.preventDefault();post('openLink',{url})}}
      parent.appendChild(el);last=pattern.lastIndex;
    }parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function renderText(parent,text){
    const lines=String(text).split(/\r?\n/), fence=String.fromCharCode(96).repeat(3);let code=null, codeLines=[];
    function finishCode(){const pre=document.createElement('pre'),block=document.createElement('code'),button=document.createElement('button');const value=codeLines.join('\n');block.textContent=value;button.textContent='复制';button.title='复制代码';button.onclick=()=>{post('copy',{text:value});button.textContent='已复制'};pre.append(button,block);parent.appendChild(pre);code=null;codeLines=[]}
    let list=null, listType='';
    for(const line of lines){
      if(line.trimStart().startsWith(fence)){list=null;if(code!==null)finishCode();else code=line.trimStart().slice(3);continue}
      if(code!==null){codeLines.push(line);continue}
      const item=line.match(/^\s*(?:([-*+])\s+|(\d+)[.)]\s+)(.*)$/);
      if(item){const type=item[2]?'ol':'ul';if(!list||listType!==type){list=document.createElement(type);listType=type;parent.appendChild(list)}const li=document.createElement('li');inline(li,item[3]);list.appendChild(li);continue}
      list=null;const heading=line.match(/^(#{1,3})\s+(.+)$/),quote=line.match(/^\s*>\s?(.*)$/);
      const row=document.createElement(heading?'h'+heading[1].length:quote?'blockquote':'div');inline(row,heading?heading[2]:quote?quote[1]:line);if(!line)row.appendChild(document.createElement('br'));parent.appendChild(row)
    }if(code!==null)finishCode();
  }
  function post(type,extra={}){vscode.postMessage({type,...extra})}
  function renderHistory(s){
    const box=$('historyList');box.replaceChildren();box.hidden=!historyVisible;
    if(!historyVisible)return;
    const list=s.conversations||[];const heading=document.createElement('div');heading.className='history-heading';heading.textContent='对话';box.appendChild(heading);
    for(const item of (historyExpanded?list:list.slice(0,3))){const row=document.createElement('button');row.className='history-row';row.title=item.title+(item.projectName?' — '+item.projectName:'');const title=document.createElement('span');title.className='history-title';title.textContent=item.title;const time=document.createElement('span');time.className='history-time';if(item.updatedAt){const date=new Date(item.updatedAt);if(!isNaN(date))time.textContent=date.toLocaleDateString()}row.append(title,time);row.onclick=()=>{if(s.busy)return;historyVisible=false;post('openHistory',{sessionId:item.sessionId})};box.appendChild(row)}
    if(!list.length){const empty=document.createElement('div');empty.className='muted';empty.textContent='暂无对话记录';box.appendChild(empty)}
    if(list.length>3){const more=document.createElement('button');more.className='history-more';more.textContent=historyExpanded?'收起':'查看全部 ('+list.length+')';more.onclick=()=>{historyExpanded=!historyExpanded;renderHistory(state)};box.appendChild(more)}
  }
  const openTools=new Set();
  const thinkingChoices=new Map();
  const thinkingScroll=new Map();
  function renderThinking(m,index){
    const key=String(m.id||('thinking-'+index)),card=document.createElement('details');card.className='thinking-card';
    card.open=thinkingChoices.has(key)?thinkingChoices.get(key):!m.finished;
    const heading=document.createElement('summary');heading.textContent=m.finished?'思考过程':'正在思考…';
    const content=document.createElement('div');content.className='thinking-content';if(card.open)content.textContent=m.text||'';
    const restore=()=>{const saved=thinkingScroll.get(key);if(saved)content.scrollTop=saved.follow?content.scrollHeight:saved.top;else if(!m.finished)content.scrollTop=content.scrollHeight;};
    content.onscroll=()=>thinkingScroll.set(key,{top:content.scrollTop,follow:content.scrollHeight-content.scrollTop-content.clientHeight<30});
    card.restoreScroll=restore;
    heading.onclick=e=>{e.preventDefault();card.open=!card.open;if(card.open){content.textContent=m.text||'';restore()}thinkingChoices.set(key,card.open)};
    card.append(heading,content);return card;
  }
  function renderTool(m,index){
    const p=m.presentation||{}, key=String(m.id||('tool-'+index));const card=document.createElement('details');card.className='tool-card';card.open=openTools.has(key);card.ontoggle=()=>{if(card.open)openTools.add(key);else openTools.delete(key)};
    const summary=document.createElement('summary'), icon=document.createElement('span'),title=document.createElement('span'),description=document.createElement('span'),status=document.createElement('span'),chevron=document.createElement('span');
    icon.className='tool-icon';icon.textContent=p.path?'▤':p.code?'›_':'◇';title.className='tool-title';title.textContent=p.title||m.name||'工具';description.className='tool-summary';description.textContent=p.summary||'';description.title=p.summary||'';status.className='tool-status'+(m.isError?' failed':'');status.textContent=m.isError?'失败':m.result!==undefined?'完成':state.busy?'进行中':'未记录结果';chevron.className='tool-chevron';chevron.textContent='›';summary.append(icon,title,description,status,chevron);card.appendChild(summary);
    const body=document.createElement('div');body.className='tool-body';function section(label,value){if(value===undefined||value===null||value==='')return;const heading=document.createElement('div');heading.className='tool-section-title';heading.textContent=label;const pre=document.createElement('pre');pre.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);body.append(heading,pre)}
    if(p.code)section(p.language?'内容 · '+p.language:'内容',p.code);section('参数',p.input||m.input);
    const result=Array.isArray(m.result)?m.result.map(part=>part&&part.type==='text'?part.text:part&&part.type==='image'?'[图片结果]':JSON.stringify(part)).join('\n'):m.result;
    section(m.isError?'错误详情':'结果',result);card.appendChild(body);return card;
  }
  function render(s){state=s;renderHistory(s);const box=$('messages'),scroll=$('scroll');const follow=followNextSend||scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<60;followNextSend=false;const priorTop=scroll.scrollTop;box.replaceChildren();if(!s.messages.length){const e=document.createElement('div');e.className='empty';e.textContent='开始新的 Claude Code 对话';box.appendChild(e)}else s.messages.forEach((m,index)=>{if(m.role==='tool'){box.appendChild(renderTool(m,index));return}if(m.role==='thinking'){const card=renderThinking(m,index);box.appendChild(card);if(card.open)card.restoreScroll();return}const d=document.createElement('div');d.className='message '+m.role;const label=document.createElement('div');label.className='label';label.textContent=({user:'你',assistant:'Claude',error:'错误'})[m.role]||m.role;const text=document.createElement('div');if(m.role==='assistant')renderText(text,m.text);else text.textContent=m.text;d.append(label,text);box.appendChild(d)});if(s.busy){const indicator=document.createElement('div');indicator.className='activity';indicator.textContent=s.permission?'\u7b49\u5f85\u4f60\u786e\u8ba4\u2026':(s.progress||'Claude \u6b63\u5728\u5904\u7406\u2026');box.appendChild(indicator)}if(follow)scroll.scrollTop=scroll.scrollHeight;else scroll.scrollTop=priorTop; const p=$('provider');p.replaceChildren();if(!s.active){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='\u8bf7\u9009\u62e9 Provider';placeholder.selected=true;placeholder.disabled=true;p.appendChild(placeholder)}for(const provider of s.providers){const o=document.createElement('option');o.value=provider.id;o.textContent=provider.name;o.selected=provider.id===s.active;p.appendChild(o)}p.disabled=s.busy;$('model').disabled=s.busy;$('model').textContent=s.model||'默认模型';$('model').title='选择模型：'+(s.model||'Provider 默认');$('send').hidden=s.busy;$('stop').hidden=!s.busy; const perm=$('permission'), permissionId=s.permission?.requestId || null;if(permissionId!==renderedPermissionId){renderedPermissionId=permissionId;perm.replaceChildren();if(s.permission){const card=document.createElement('div');card.className='permission';const title=document.createElement('strong');title.textContent='允许工具操作：'+s.permission.name;const pre=document.createElement('pre');pre.textContent=JSON.stringify(s.permission.input,null,2);card.append(title,pre);const questions=s.permission.name==='AskUserQuestion'&&Array.isArray(s.permission.input?.questions)?s.permission.input.questions:[];const controls=[];for(const q of questions){const wrap=document.createElement('div'),label=document.createElement('label');label.textContent=q.question;wrap.appendChild(label);let control;if(Array.isArray(q.options)&&q.options.length){control=document.createElement('select');if(q.multiSelect)control.multiple=true;for(const option of q.options){const o=document.createElement('option');o.value=option.label;o.textContent=option.label+(option.description?' - '+option.description:'');control.appendChild(o)}const other=document.createElement('option');other.value='__other__';other.textContent='\u5176\u4ed6';control.appendChild(other);wrap.appendChild(control);const custom=document.createElement('input');custom.placeholder='\u5176\u4ed6\u7b54\u6848';custom.style.width='100%';wrap.appendChild(custom);controls.push({q,control,custom})}else{control=document.createElement('input');control.style.width='100%';wrap.appendChild(control);controls.push({q,control})}card.appendChild(wrap)}const yes=document.createElement('button');yes.className='send';yes.textContent=questions.length?'\u63d0\u4ea4\u56de\u7b54':'\u5141\u8bb8';yes.onclick=()=>{let updatedInput;if(questions.length){const answers={};for(const {q,control,custom} of controls){const selected=control.multiple?Array.from(control.selectedOptions).map(o=>o.value):[control.value];answers[q.question]=selected.map(v=>v==='__other__'?custom.value.trim():v).filter(Boolean).join(', ');if(!answers[q.question]){control.focus();return}}updatedInput={...s.permission.input,answers}}post('permission',{requestId:s.permission.requestId,allow:true,updatedInput})};const no=document.createElement('button');no.textContent='拒绝';no.onclick=()=>post('permission',{requestId:s.permission.requestId,allow:false});if(questions.length)pre.hidden=true;card.append(yes,no);perm.appendChild(card)}}if(!settingsOpen){$('template').value=s.settings.text;$('placement').value=s.settings.placement}}
  window.addEventListener('message',e=>{if(e.data.type==='state')render(e.data);else if(e.data.type==='showPromptSettings'){settingsOpen=true;$('settings').hidden=false;$('template').focus()}});function insert(){const text=state.settings.text;if(!text){settingsOpen=true;$('settings').hidden=false;$('template').focus();return}const input=$('input'),start=input.selectionStart,end=input.selectionEnd;input.setRangeText(text,start,end,'end');input.focus()}function send(){const input=$('input');if(!input.value.trim()||state.busy)return;historyVisible=false;renderHistory(state);followNextSend=true;post('send',{text:input.value});input.value=''}$('send').onclick=send;$('stop').onclick=()=>post('cancel');$('input').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='p'){e.preventDefault();insert()}else if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}};$('insert').onclick=insert;$('new').onclick=()=>{historyVisible=true;historyExpanded=false;post('new')};$('history').onclick=()=>{historyVisible=!historyVisible;historyExpanded=false;renderHistory(state);if(historyVisible)post('history')};$('terminal').onclick=()=>post('terminal');$('provider').onchange=e=>post('provider',{id:e.target.value});$('settingsButton').onclick=()=>post('settingsMenu');$('model').onclick=()=>post('selectModel');$('closeSettings').onclick=()=>{settingsOpen=false;$('settings').hidden=true};$('save').onclick=()=>{post('savePrompt',{text:$('template').value,placement:$('placement').value});settingsOpen=false;$('settings').hidden=true};post('ready');
  </script></body></html>`;
}
module.exports = { SidebarChatView };
