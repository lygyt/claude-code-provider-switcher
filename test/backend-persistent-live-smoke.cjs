'use strict';
// Exercise the real backend and installed CLI against only a loopback fake provider.
const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-backend-live-test-'));
process.env.CLAUDE_CONFIG_DIR=root;process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';process.env.DISABLE_TELEMETRY='1';process.env.DISABLE_ERROR_REPORTING='1';
const exe=path.join(process.env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin','claude.exe');
const requests=[];const server=http.createServer((req,res)=>{if(!req.url.includes('/v1/messages')){res.writeHead(404);res.end();return}let data='';req.setEncoding('utf8');req.on('data',s=>{data+=s});req.on('end',()=>{const body=JSON.parse(data);requests.push(body);const n=requests.length;res.writeHead(200,{'content-type':'text/event-stream'});const events=[{type:'message_start',message:{id:`msg_${n}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:`local reply ${n}`}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}},{type:'message_stop'}];for(const event of events)res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);res.end()})});
const original=Module._load;
Module._load=function(id,parent){
  if(id==='vscode')return {workspace:{isTrusted:true,workspaceFolders:[{uri:{fsPath:root}}],getWorkspaceFolder:()=>({uri:{fsPath:root}})},window:{},Uri:{file:fsPath=>({fsPath})}};
  if(parent?.filename.endsWith('sidebarChatBackend.js')){
    if(id==='./claudeCli')return {resolveClaudeExecutable:async()=>exe};
    if(id==='./terminalLauncher')return {buildClaudeTerminalEnv:(provider,token)=>({ANTHROPIC_BASE_URL:provider.baseUrl,ANTHROPIC_API_KEY:token,ANTHROPIC_AUTH_TOKEN:null,ANTHROPIC_MODEL:provider.model,ANTHROPIC_DEFAULT_OPUS_MODEL:null,ANTHROPIC_DEFAULT_SONNET_MODEL:null,ANTHROPIC_DEFAULT_HAIKU_MODEL:null}),prepareSkillLaunchSelection:async selection=>selection};
    if(id==='./validation')return {authTypeRequiresToken:()=>true};
    if(id==='./vscodeUtils')return {getConfig:()=>({permissionMode:'requestApproval'})};
  }
  return original.apply(this,arguments);
};
const {SidebarChatBackend}=require('../src/sidebarChatBackend');Module._load=original;
server.listen(0,'127.0.0.1',async()=>{
  let model='test-model-one',session;const events=[];let settle;
  const backend=new SidebarChatBackend({store:{getActiveProvider:async()=>({id:'test',name:'local',authType:'anthropic-api-key',model,baseUrl:`http://127.0.0.1:${server.address().port}`}),getToken:async()=>'local-test-key'},skillStore:{getInstalledSkills:async()=>[],getAutoUseSkill:async()=>undefined},onEvent:event=>{events.push(event);if(event.type==='session')session=event.sessionId;if(event.type==='done'&&settle)settle();}});
  async function run(text){const start=events.length;let timer;const done=new Promise((resolve,reject)=>{settle=resolve;timer=setTimeout(()=>reject(new Error('backend turn timed out')),20000)});await backend.send(text,{cwd:root,sessionId:session});const pid=backend.child?.pid;try{await done}finally{clearTimeout(timer);settle=undefined}const turnEvents=events.slice(start);assert.equal(turnEvents.filter(e=>e.type==='error').length,0,JSON.stringify(turnEvents.filter(e=>e.type==='error')));return {pid,text:turnEvents.filter(e=>e.type==='text').map(e=>e.text).join('')}}
  try{
    const first=await run('first question');const second=await run('second question');assert.equal(first.pid,second.pid);assert.equal(first.text,'local reply 1');assert.equal(second.text,'local reply 2');
    model='test-model-two';const third=await run('third question');assert.notEqual(second.pid,third.pid);assert.equal(third.text,'local reply 3');assert.equal(requests.length,3);assert.equal(requests[2].model,'test-model-two');const conversation=JSON.stringify(requests[2].messages);for(const s of ['first question','local reply 1','second question','local reply 2','third question'])assert.ok(conversation.includes(s),`missing ${s}`);
    console.log(JSON.stringify({ok:true,firstTwoSameProcess:true,modelChangeNewProcess:true,allPriorContextRetained:true}));
  }catch(error){console.error(error);process.exitCode=1}finally{await backend.reset();server.closeAllConnections();server.close()}
});
