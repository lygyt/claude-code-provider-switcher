'use strict';
const vscode = require('vscode');

const contextKey = 'claudeCodeProviderSwitcher.managementView';

async function hideManagement() {
  await vscode.commands.executeCommand('setContext', contextKey, '');
  await vscode.commands.executeCommand('claudeCodeProviderSwitcher.chat.focus');
}

async function showSettingsMenu(store) {
  const provider = await store.getActiveProvider();
  const choices = [
    { label: '$(symbol-string) 常用提示词', description: '编辑提示词和自动插入位置', action: 'prompt' },
    { label: '$(plug) 切换 Provider', description: provider?.name || '选择服务商', command: 'claudeCodeProviderSwitcher.selectProvider' },
    { label: '$(symbol-namespace) 选择模型', description: provider?.model || '使用 Provider 默认模型', command: 'claudeCodeProviderSwitcher.selectModel' },
    { label: '$(settings-gear) Provider 与权限管理', description: '配置 Provider 和工具权限', view: 'providers' },
    { label: '$(tools) 技能管理', description: '安装、分组和选择技能', view: 'skills' },
    { label: '$(list-tree) 工作流管理', description: '创建、编辑和运行工作流', view: 'workflows' },
    { label: '$(close) 收起管理面板', action: 'hide' }
  ];
  const selected = await vscode.window.showQuickPick(choices, { title: 'Claude Code 设置', placeHolder: '选择要管理的内容' });
  if (!selected) return;
  if (selected.action === 'prompt') return 'prompt';
  if (selected.action === 'hide') return hideManagement();
  if (selected.command) {
    await hideManagement();
    await vscode.commands.executeCommand(selected.command);
    return;
  }
  if (selected.view) {
    await vscode.commands.executeCommand('setContext', contextKey, selected.view);
    await vscode.commands.executeCommand(`claudeCodeProviderSwitcher.${selected.view}.focus`);
  }
}

module.exports = { showSettingsMenu, hideManagement };
