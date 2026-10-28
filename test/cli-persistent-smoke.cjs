'use strict';
// Actual installed CLI, a loopback fake provider, and isolated temporary config.
// This makes no paid requests and uses no real credentials or user prompts.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const exe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-persistent-test-'));
let requests = 0; const bodies=[];
const server = http.createServer((req,res) => {
  if (!req.url.includes('/v1/messages')) { res.writeHead(404); res.end(); return; }
  let body='';req.setEncoding('utf8');req.on('data',chunk=>{body+=chunk;});
  req.on('end',()=>{
  bodies.push(JSON.parse(body));requests++;
  res.writeHead(200, {'content-type':'text/event-stream'});
  const result = `local reply ${requests}`;
  const events = [
    {type:'message_start',message:{id:`msg_${requests}`,type:'message',role:'assistant',model:'test',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:result}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}},
    {type:'message_stop'}
  ];
  for(const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
  });
});
server.listen(0,'127.0.0.1',() => {
  const env={...process.env,CLAUDE_CONFIG_DIR:root,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'local-test-key',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
  delete env.ANTHROPIC_AUTH_TOKEN;
  const child=spawn(exe,['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--permission-prompt-tool','stdio','--permission-mode','default'],{env,cwd:root,windowsHide:true});
  let buffer='',stderr='',results=[],sequence=[],timeout=false;
  const timer=setTimeout(()=>{timeout=true;child.kill();},30000);
  function send(text,sessionId=''){child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:sessionId})+'\n');}
  child.stdout.on('data',chunk=>{
    buffer+=chunk;const lines=buffer.split(/\r?\n/);buffer=lines.pop();
    for(const line of lines){let m;try{m=JSON.parse(line)}catch{continue}
      if(m.type==='result'){
        sequence.push({type:m.type,session_id:m.session_id,result:m.result,is_error:m.is_error});results.push(m);
        if(results.length===1) { assert.equal(child.exitCode,null); send('second turn',m.session_id); }
        else if(results.length===2) child.stdin.end();
      }
    }
  });
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.on('close',code=>{
    clearTimeout(timer);server.close();
    try{assert.equal(timeout,false,'timed out');assert.equal(code,0,stderr);assert.equal(results.length,2);assert.equal(requests,2);assert.equal(results[0].result,'local reply 1');assert.equal(results[1].result,'local reply 2');assert.equal(results[0].session_id,results[1].session_id);const conversation=JSON.stringify(bodies[1].messages);assert.match(conversation,/first turn/);assert.match(conversation,/local reply 1/);assert.match(conversation,/second turn/);console.log(JSON.stringify({ok:true,requests,contextRetained:true,sequence}));}
    catch(error){console.error(error);process.exitCode=1;}
  });
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'initialize',request:{subtype:'initialize',hooks:null}})+'\n');
  send('first turn');
});
