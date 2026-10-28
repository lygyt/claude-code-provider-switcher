'use strict';
// Probe SDK interrupt with the actual CLI and a localhost-only fake API.
const assert=require('node:assert/strict');
const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const exe=path.join(process.env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin','claude.exe');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-interrupt-test-'));
let requestCount=0,child;
const server=http.createServer((req,res)=>{
  req.resume();if(!req.url.includes('/v1/messages')){res.writeHead(404);res.end();return;}
  requestCount++;res.writeHead(200,{'content-type':'text/event-stream'});
  if(requestCount===1){res.write(': waiting\n\n');setTimeout(()=>child.stdin.write(JSON.stringify({type:'control_request',request_id:'interrupt',request:{subtype:'interrupt'}})+'\n'),300);return;}
  const events=[{type:'message_start',message:{id:'msg_2',type:'message',role:'assistant',model:'test',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'after interrupt'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}},{type:'message_stop'}];for(const e of events)res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);res.end();
});
server.listen(0,'127.0.0.1',()=>{
  const env={...process.env,CLAUDE_CONFIG_DIR:root,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'local-test-key',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};delete env.ANTHROPIC_AUTH_TOKEN;
  child=spawn(exe,['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--permission-prompt-tool','stdio','--permission-mode','default'],{env,cwd:root,windowsHide:true});
  const timer=setTimeout(()=>{child.kill();server.closeAllConnections();},15000);let buffer='',messages=[],results=0;
  const send=(text,id='')=>child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:id})+'\n');
  child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines){let m;try{m=JSON.parse(line)}catch{continue}if(m.type==='result'){messages.push({type:m.type,subtype:m.subtype,is_error:m.is_error,result:m.result});results++;if(results===1)send('second turn',m.session_id);else child.stdin.end();}else if(m.type==='control_response')messages.push({type:m.type,subtype:m.response?.subtype,request_id:m.response?.request_id});}});
  child.on('close',code=>{clearTimeout(timer);server.closeAllConnections();server.close();console.log(JSON.stringify({code,requestCount,messages}));try{assert.equal(code,0);assert.equal(requestCount,2);assert.equal(results,2);assert.equal(messages.at(-1).result,'after interrupt');}catch(error){console.error(error.message);process.exitCode=1;}});
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'initialize',request:{subtype:'initialize',hooks:null}})+'\n');send('first turn');
});
