'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const exe=path.join(process.env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin','claude.exe');
const root=path.join(process.cwd(),'tmp-protocol-config');fs.mkdirSync(root,{recursive:true});
const server=http.createServer((req,res)=>{
  req.resume();if(!req.url.includes('/v1/messages')){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const events=[
    {type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'test',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}},
    {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},
    {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'local thinking sample'}},
    {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sample'}},
    {type:'content_block_stop',index:0},
    {type:'content_block_start',index:1,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:1,delta:{type:'text_delta',text:'local final sample'}},
    {type:'content_block_stop',index:1},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}},
    {type:'message_stop'}
  ];for(const e of events)res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);res.end();
});
server.listen(0,'127.0.0.1',()=>{
  const env={...process.env,CLAUDE_CONFIG_DIR:root,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'local-test-key',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};delete env.ANTHROPIC_AUTH_TOKEN;
  const child=spawn(exe,['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--permission-prompt-tool','stdio','--permission-mode','default'],{env,cwd:root,windowsHide:true});
  let buffer='',seen=[]; const timer=setTimeout(()=>child.kill(),20000);
  child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines){let m;try{m=JSON.parse(line)}catch{continue}if(m.type==='stream_event'){const e=m.event;seen.push({type:e.type,index:e.index,block:e.content_block?.type,delta:e.delta?.type,thinking:e.delta?.thinking});}if(m.type==='assistant')seen.push({type:'assistant',blocks:m.message?.content?.map(b=>({type:b.type,thinking:b.thinking}))});if(m.type==='result')child.stdin.end();}});
  child.on('close',code=>{clearTimeout(timer);server.close();console.log(JSON.stringify({code,events:seen}));if(!seen.some(e=>e.delta==='thinking_delta'&&e.thinking==='local thinking sample'))process.exitCode=1;});
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'initialize',request:{subtype:'initialize',hooks:null}})+'\n');child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:'test'},parent_tool_use_id:null,session_id:''})+'\n');
});
