'use strict';
// Exercise the installed CLI's SDK initialization without sending a prompt.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const exe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const configDir = path.join(process.cwd(), 'tmp-protocol-config');
fs.mkdirSync(configDir, { recursive: true });
const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' };
delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
const child = spawn(exe, ['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--permission-prompt-tool','stdio','--permission-mode','default'], { env, cwd: process.cwd(), windowsHide: true });
let output = ''; let err = '';
const timer = setTimeout(() => child.kill(), 8000);
child.stdout.on('data', chunk => { output += chunk; if (output.includes('"request_id":"initialize"')) child.kill(); });
child.stderr.on('data', chunk => { err += chunk; });
child.on('close', () => {
  clearTimeout(timer);
  const response = output.split(/\r?\n/).filter(Boolean).map(s => { try { return JSON.parse(s); } catch { return {}; } }).find(m => m.type === 'control_response' && m.response?.request_id === 'initialize');
  if (!response || response.response.subtype !== 'success') { console.error('CLI initialization failed', output, err); process.exitCode = 1; return; }
  console.log('Installed Claude CLI accepted stream-json initialization.');
});
child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize', hooks: null } }) + '\n');
