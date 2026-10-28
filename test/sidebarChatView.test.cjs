'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

let history = [];
let warnings = [];
let saved = [];
let sent = [];
let commands = [];
const root = path.join(os.tmpdir(), 'sidebar-chat-view-test');
const vscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: root } }],
    getWorkspaceFolder: () => ({ uri: { fsPath: root } }),
    getConfiguration: () => ({
      get: (key, fallback) => fallback,
      inspect: key => ({ workspaceValue: key === 'promptTemplate' ? 'workspace text' : undefined }),
      update: async (key, value, target) => saved.push({ key, value, target })
    })
  },
  window: { activeTextEditor: undefined, showWarningMessage: async msg => warnings.push(msg) },
  commands: { executeCommand: async (...args) => { commands.push(args); } },
  ConfigurationTarget: { Global: 1, Workspace: 2 }
};
class Backend {
  constructor({onEvent}) { this.onEvent = onEvent; this.resets = 0; }
  async send(text, options) { sent.push({text, options}); }
  respondPermission() {}
  cancel() {}
  reset() { this.resets++; }
  dispose() {}
}
const originalLoad = Module._load;
Module._load = function(request) {
  if (request === 'vscode') return vscode;
  if (request === './conversationHistory') return { loadClaudeConversations: async () => history };
  if (request === './sidebarChatBackend') return { SidebarChatBackend: Backend };
  return originalLoad.apply(this, arguments);
};
const { SidebarChatView } = require('../dist/sidebarChatView');
Module._load = originalLoad;
const store = { getProviders: async () => [{id:'p',name:'P'}], getActiveProviderId: async () => 'p', setActiveProviderId: async () => {} };
function create() { return new SidebarChatView(store, {}, {refresh: async () => {}}, {refresh: () => {}}); }

test('webview script is valid and composer can be initialised', async () => {
  const v = create(); let handler;
  const webview = { onDidReceiveMessage(fn) { handler = fn; }, postMessage: async () => {} };
  v.resolveWebviewView({webview});
  assert.equal(typeof handler, 'function');
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(webview.html, /Ctrl\+Alt\+P/);
});

test('assistant Markdown uses safe DOM text and code blocks can be copied', () => {
  const v = create();
  const webview = { onDidReceiveMessage() {}, postMessage: async () => {} };
  v.resolveWebviewView({webview});
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
  }
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); },
    createElement: tag => new Element(tag), createTextNode: value => ({tag:'#text', textContent:value}) };
  const posted = []; let receive;
  const window = { addEventListener: (name, fn) => { if (name === 'message') receive = fn; } };
  vm.runInNewContext(script, { document, window, acquireVsCodeApi: () => ({postMessage: msg => posted.push(msg)}) });
  receive({data:{type:'state', messages:[{role:'assistant',text:'<img src=x onerror=alert(1)>\n```js\nhello()\n```'}], providers:[], active:null, busy:false, settings:{text:'',placement:'off'}}});
  const walk = (el, tag) => [el, ...(el.children || []).flatMap(c => walk(c, tag))].filter(e => e.tag === tag);
  const messages = elements.get('messages');
  assert.equal(walk(messages, 'img').length, 0);
  assert.equal(walk(messages, 'code')[0].textContent, 'hello()');
  walk(messages, 'button')[0].onclick();
  assert.equal(posted.at(-1).type, 'copy');
  assert.equal(posted.at(-1).text, 'hello()');
});

test('tool calls render as compact expandable cards and retain state while streaming', () => {
  const view = create(); const webview = { onDidReceiveMessage() {}, postMessage: async () => {} };
  view.resolveWebviewView({webview});
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  class Element {
    constructor(tag) { this.tag=tag; this.children=[]; this.style={}; this.value=''; this.scrollTop=10; this.scrollHeight=500; this.clientHeight=100; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; }
  }
  const elements=new Map(); const document={ getElementById(id) { if(!elements.has(id)) elements.set(id,new Element(id)); return elements.get(id); }, createElement: tag=>new Element(tag), createTextNode: value=>({tag:'#text',textContent:value}) };
  let receive; const window={addEventListener: (name,fn)=>{if(name==='message')receive=fn;}};
  vm.runInNewContext(script,{document,window,acquireVsCodeApi:()=>({postMessage(){}})});
  const state={type:'state',messages:[{role:'tool',id:'one',name:'Write',input:{file_path:'test.py'},presentation:{title:'写入文件',summary:'test.py',input:{file_path:'test.py'}}}],providers:[],busy:true,settings:{text:'',placement:'off'}};
  receive({data:state});
  const card=elements.get('messages').children[0]; assert.equal(card.tag,'details'); assert.equal(card.open,false);
  card.open=true; card.ontoggle(); receive({data:state});
  assert.equal(elements.get('messages').children[0].open,true);
  assert.equal(elements.get('scroll').scrollTop,10);
});

test('thinking streams as plain text in an expandable card with user choice retained', () => {
  const view=create(), webview={onDidReceiveMessage(){},postMessage:async()=>{}}; view.resolveWebviewView({webview});
  const script=webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  class Element { constructor(tag){this.tag=tag;this.children=[];this.style={};this.scrollTop=0;this.scrollHeight=500;this.clientHeight=100;} appendChild(c){this.children.push(c);return c;} append(...c){this.children.push(...c);} replaceChildren(...c){this.children=c;} }
  const elements=new Map(), document={getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},createElement:tag=>new Element(tag),createTextNode:value=>({tag:'#text',textContent:value})};
  let receive;const window={addEventListener:(name,fn)=>{if(name==='message')receive=fn;}};
  vm.runInNewContext(script,{document,window,acquireVsCodeApi:()=>({postMessage(){}})});
  const state={type:'state',messages:[{role:'thinking',id:'b',text:'<script>unsafe</script>',finished:false}],providers:[],busy:true,settings:{text:'',placement:'off'}};
  receive({data:state});let card=elements.get('messages').children[0];assert.equal(card.tag,'details');assert.equal(card.open,true);assert.equal(card.children[1].textContent,'<script>unsafe</script>');
  card.children[1].scrollTop=42;card.children[1].onscroll();receive({data:state});card=elements.get('messages').children[0];assert.equal(card.children[1].scrollTop,42);
  card.children[0].onclick({preventDefault(){}});assert.equal(card.open,false);receive({data:state});card=elements.get('messages').children[0];assert.equal(card.open,false);
  card.children[0].onclick({preventDefault(){}});assert.equal(card.children[1].textContent,'<script>unsafe</script>');
  receive({data:{...state,busy:false,messages:[{...state.messages[0],finished:true}]}});card=elements.get('messages').children[0];assert.equal(card.open,true);
});

test('thinking increments and text are coalesced, and completion flushes the final content', async () => {
  const view=create(); let updates=0;view.refresh=async()=>{updates++;};
  view.onEvent({type:'thinking',blockId:'b',text:'one'});view.onEvent({type:'thinking',blockId:'b',text:' two'});view.onEvent({type:'thinkingEnd',blockId:'b'});
  assert.deepEqual(view.messages[0],{role:'thinking',id:'b',text:'one two',finished:true});assert.equal(updates,1);
  view.onEvent({type:'text',text:'hello'});view.onEvent({type:'text',text:' world'});await new Promise(resolve=>setTimeout(resolve,90));assert.equal(updates,2);assert.equal(view.messages[1].text,'hello world');
  view.onEvent({type:'session',sessionId:'a'});assert.equal(updates,3);view.onEvent({type:'session',sessionId:'a'});assert.equal(updates,3);
  view.onEvent({type:'text',text:'!'});view.onEvent({type:'result',is_error:false});assert.equal(updates,4);assert.equal(view.messages[1].text,'hello world!');
  await new Promise(resolve=>setTimeout(resolve,90));assert.equal(updates,4);view.dispose();
});

test('historical thinking is restored in order and starts folded', async () => {
  await fs.mkdir(root,{recursive:true});const file=path.join(root,'thinking-history.jsonl');
  await fs.writeFile(file,JSON.stringify({type:'assistant',cwd:root,message:{content:[{type:'thinking',thinking:'first thought'},{type:'text',text:'answer'}]}}));
  history=[{sessionId:'thinking-session',filePath:file}];const view=create();await view.open('thinking-session');
  assert.deepEqual(view.messages.map(m=>({role:m.role,text:m.text,finished:m.finished})),[{role:'thinking',text:'first thought',finished:true},{role:'assistant',text:'answer',finished:true}]);
});

test('sending from an earlier scroll position follows the new turn and shows pending activity', () => {
  const view=create(), webview={onDidReceiveMessage(){},postMessage:async()=>{}};
  view.resolveWebviewView({webview});
  const script=webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.value='';this.scrollTop=10;this.scrollHeight=500;this.clientHeight=100;}
    appendChild(child){this.children.push(child);return child;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
  }
  const elements=new Map(), document={getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},createElement:tag=>new Element(tag),createTextNode:value=>({tag:'#text',textContent:value})};
  const posted=[];let receive;const window={addEventListener:(name,fn)=>{if(name==='message')receive=fn;}};
  vm.runInNewContext(script,{document,window,acquireVsCodeApi:()=>({postMessage:msg=>posted.push(msg)})});
  const initial={type:'state',messages:[{role:'assistant',text:'previous'}],providers:[],busy:false,settings:{text:'',placement:'off'}};
  receive({data:initial});elements.get('input').value='hello';elements.get('send').onclick();
  assert.equal(posted.at(-1).type,'send');
  receive({data:{...initial,busy:true,messages:[...initial.messages,{role:'user',text:'hello'}]}});
  assert.equal(elements.get('scroll').scrollTop,500);
  assert.equal(elements.get('messages').children.at(-1).className,'activity');
  assert.match(elements.get('messages').children.at(-1).textContent,/Claude/);
  elements.get('scroll').scrollTop=10;
  receive({data:{...initial,busy:true,messages:[...initial.messages,{role:'user',text:'hello'},{role:'assistant',text:'response'}]}});
  assert.equal(elements.get('scroll').scrollTop,10);
});

test('newer progress states cannot be overwritten by an older delayed refresh', async () => {
  let release; let first=true; const states=[];
  const delayedStore={
    getProviders:()=>first?(first=false,new Promise(resolve=>{release=resolve;})):Promise.resolve([{id:'p',name:'P'}]),
    getActiveProviderId:async()=>'p'
  };
  const view=new SidebarChatView(delayedStore,{}, {refresh:async()=>{}},{refresh:()=>{}});
  view.view={webview:{postMessage:async state=>states.push(state)}};
  view.busy=true;view.progress='Connecting';const old=view.refresh();
  view.progress='Waiting for response';await view.refresh();release([{id:'p',name:'P'}]);await old;
  assert.equal(states.length,1);
  assert.equal(states[0].progress,'Waiting for response');
  view.onEvent({type:'done'});
  assert.equal(view.progress,'');
});

test('history resumes only inside the opened workspace and retains cwd for sending', async () => {
  await fs.mkdir(root, {recursive:true});
  const file = path.join(root, 'conversation.jsonl');
  const cwd = path.join(root, 'nested');
  await fs.writeFile(file, JSON.stringify({type:'user',cwd,message:{role:'user',content:'hello'}}));
  history = [{sessionId:'inside',filePath:file}];
  const v = create(); await v.open('inside');
  assert.equal(v.sessionCwd, cwd);
  assert.equal(v.backend.resets, 1);
  await v.handle({type:'send',text:'next'});
  assert.equal(sent.at(-1).options.cwd, cwd);
  assert.equal(sent.at(-1).options.sessionId, 'inside');
  const external = path.join(os.tmpdir(), 'outside-workspace');
  await fs.writeFile(file, JSON.stringify({type:'user',cwd:external,message:{role:'user',content:'no'}}));
  history = [{sessionId:'outside',filePath:file}]; warnings = [];
  const other = create(); await other.open('outside');
  assert.equal(other.sessionId, undefined);
  assert.equal(other.backend.resets, 0);
  assert.equal(warnings.length, 1);
});

test('new chat resets the idle session without interrupting an active response', async () => {
  const v = create(); v.sessionId = 'old';
  v.busy = true; await v.handle({type:'new'});
  assert.equal(v.backend.resets, 0); assert.equal(v.sessionId, 'old');
  v.busy = false; await v.handle({type:'new'});
  assert.equal(v.backend.resets, 1); assert.equal(v.sessionId, undefined);
});

test('only changing provider resets the idle process', async () => {
  let active='p';
  const localStore={getProviders:async()=>[{id:'p',name:'P'},{id:'q',name:'Q'}],getActiveProviderId:async()=>active,setActiveProviderId:async id=>{active=id;}};
  const v=new SidebarChatView(localStore,{}, {refresh:async()=>{}},{refresh:()=>{}});
  v.sessionId='session-123'; v.sessionCwd=root; v.messages=[{role:'assistant',text:'earlier answer'}];
  await v.handle({type:'provider',id:'p'}); assert.equal(v.backend.resets,0);
  await v.handle({type:'provider',id:'q'}); assert.equal(v.backend.resets,1); assert.equal(active,'q');
  assert.equal(v.sessionId,'session-123'); assert.equal(v.sessionCwd,root); assert.equal(v.messages[0].text,'earlier answer');
  await v.handle({type:'send',text:'continue after change'});
  assert.equal(sent.at(-1).options.sessionId,'session-123'); assert.equal(sent.at(-1).options.cwd,root);
  v.busy=true; await v.handle({type:'provider',id:'p'}); assert.equal(v.backend.resets,1); assert.equal(active,'q');
});

test('live and resumed conversations preserve tool details and results', async () => {
  const live = create();
  live.onEvent({type:'tool', id:'tool-1', name:'Write', input:{file_path:'hello.py', content:'print(1)'}});
  live.onEvent({type:'toolResult', id:'tool-1', content:'saved', is_error:false});
  assert.deepEqual(live.messages[0], {role:'tool', id:'tool-1', name:'Write', input:{file_path:'hello.py', content:'print(1)'}, text:'Write\n{\n  "file_path": "hello.py",\n  "content": "print(1)"\n}', result:'saved', isError:false});
  await fs.mkdir(root, {recursive:true});
  const file = path.join(root, 'tool-history.jsonl');
  await fs.writeFile(file, [
    JSON.stringify({type:'assistant', cwd:root, message:{content:[{type:'text',text:'Working'}, {type:'tool_use',id:'tool-1',name:'Write',input:{file_path:'hello.py'}}]}}),
    JSON.stringify({type:'user', message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'failed',is_error:true}]}})
  ].join('\n'));
  history = [{sessionId:'tool-session',filePath:file}];
  const resumed = create(); await resumed.open('tool-session');
  assert.equal(resumed.messages[0].text, 'Working');
  assert.deepEqual(resumed.messages[1], {role:'tool',id:'tool-1',name:'Write',input:{file_path:'hello.py'},text:'Write\n{\n  "file_path": "hello.py"\n}',result:'failed',isError:true});
});

test('prompt settings update the scope that currently overrides the value', async () => {
  saved = []; await create().handle({type:'savePrompt',text:'new',placement:'append'});
  assert.deepEqual(saved, [{key:'promptTemplate',value:'new',target:2},{key:'promptPlacement',value:'append',target:1}]);
});

test('settings and model buttons invoke their commands, and model changes are blocked during a reply', async () => {
  commands = [];
  const view = create();
  view.sessionId = 'model-session'; view.sessionCwd = root; view.messages = [{role:'user',text:'earlier message'}];
  await view.handle({type:'settingsMenu'});
  await view.handle({type:'selectModel'});
  assert.equal(view.sessionId,'model-session'); assert.equal(view.messages[0].text,'earlier message');
  await view.handle({type:'send',text:'continue after model'});
  assert.equal(sent.at(-1).options.sessionId,'model-session');
  view.busy = true;
  await view.handle({type:'selectModel'});
  assert.deepEqual(commands, [['claudeCodeProviderSwitcher.openSettingsMenu'], ['claudeCodeProviderSwitcher.selectModel']]);
});
