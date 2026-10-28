const { spawn } = require('child_process');
const path = require('path');
const exe = path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
const child = spawn(exe, ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', 'default'], {env:{...process.env, ANTHROPIC_API_KEY:'test', ANTHROPIC_BASE_URL:'http://127.0.0.1:1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}, windowsHide:true});
child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => process.stderr.write(d));
child.stdin.write(JSON.stringify({type:'control_request',request_id:'initialize',request:{subtype:'initialize',hooks:null}})+'\n');
child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:'hello'},parent_tool_use_id:null,session_id:''})+'\n');
setTimeout(()=>child.kill(), 6000);
