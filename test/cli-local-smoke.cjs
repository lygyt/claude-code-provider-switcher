'use strict';
// End-to-end CLI protocol test against a local fake Anthropic server; no real API or credentials.
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const exe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const root = path.join(process.cwd(), 'tmp-protocol-config'); fs.mkdirSync(root, { recursive: true });
let requestCount = 0;
const server = http.createServer((req, res) => {
  req.resume();
  if (!req.url.includes('/v1/messages')) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  requestCount++;
  const blockEvents = requestCount === 1 ? [
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_test', name: 'Bash', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: 'printf test > permission-test-file', description: 'test permission' }) } },
    { type: 'content_block_stop', index: 0 }
  ] : [
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'local ok' } },
    { type: 'content_block_stop', index: 0 }
  ];
  const events = [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    ...blockEvents,
    { type: 'message_delta', delta: { stop_reason: requestCount === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' }
  ];
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
});
server.listen(0, '127.0.0.1', () => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: root, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: 'local-test-key', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' };
  delete env.ANTHROPIC_AUTH_TOKEN;
  const child = spawn(exe, ['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--permission-prompt-tool','stdio','--permission-mode','default'], { env, cwd: root, windowsHide: true });
  let output = ''; let buffer = ''; let err = ''; let ok = false; let sawPermission = false;
  const timer = setTimeout(() => child.kill(), 20000);
  child.stdout.on('data', chunk => {
    output += chunk; buffer += chunk;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for (const line of lines) {
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        sawPermission = true;
        child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { behavior: 'deny', message: 'Denied by test' } } }) + '\n');
      }
      if (message.type === 'result') { ok = sawPermission && output.includes('local ok'); child.stdin.end(); }
    }
  });
  child.stderr.on('data', chunk => { err += chunk; });
  child.on('close', () => { clearTimeout(timer); server.close(); if (ok) console.log('Installed Claude CLI completed a local fake-provider turn with tool permission denial.'); else { console.error('Local provider test failed', output.slice(-4000), err.slice(-2000)); process.exitCode = 1; } });
  child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize', hooks: null } }) + '\n');
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'test' }, parent_tool_use_id: null, session_id: '' }) + '\n');
});
