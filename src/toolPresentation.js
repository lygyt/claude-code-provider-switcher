'use strict';

// Convert Claude Code tool inputs into compact, readable labels. Full input is
// still available separately to expand; never treat an attempted call as done.
function describeTool(name, input) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const text = value => typeof value === 'string' ? value : '';
  const location = text(data.file_path || data.path || data.notebook_path || data.directory);
  const command = text(data.command);
  const descriptions = {
    Write: '写入文件', Edit: '编辑文件', MultiEdit: '编辑文件', Read: '读取文件',
    Bash: '执行命令', PowerShell: '执行命令', Glob: '查找文件', Grep: '搜索内容',
    WebFetch: '访问网页', WebSearch: '搜索网络', Task: '运行子任务', Agent: '运行子任务',
    AskUserQuestion: '等待回答', Skill: '使用技能', TodoWrite: '更新任务列表'
  };
  const title = descriptions[name] || name || '工具操作';
  const summary = location || text(data.description || data.query || data.pattern || data.url || data.skill) || (command ? command.split(/\r?\n/, 1)[0] : '');
  let code = '', language = '';
  if (name === 'Write') { code = text(data.content); language = languageForPath(location); }
  else if (name === 'Edit') { code = text(data.new_string); language = languageForPath(location); }
  else if (name === 'Bash' || name === 'PowerShell') { code = command; language = name === 'Bash' ? 'shell' : 'powershell'; }
  return { title, summary, path: location, code, language, input: data };
}

function languageForPath(file) {
  const match = /\.([a-z0-9]+)$/i.exec(file);
  if (!match) return '';
  const aliases = { py: 'python', js: 'javascript', ts: 'typescript', ps1: 'powershell', sh: 'shell', yml: 'yaml', md: 'markdown' };
  return aliases[match[1].toLowerCase()] || match[1].toLowerCase();
}

module.exports = { describeTool };
