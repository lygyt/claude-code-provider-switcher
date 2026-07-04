你是一名资深 VS Code 扩展开发工程师。请从零实现一个可实际运行、可打包发布到 VS Code Marketplace 的 TypeScript 扩展。

扩展名称暂定为：

Claude Code Provider Switcher

目标是解决 Claude Code 在 Anthropic、DeepSeek 以及其他 Anthropic-compatible API Provider 之间切换时，需要反复手动修改配置文件的问题。

请直接创建完整项目代码，不要只给伪代码、设计建议或零散片段。最终项目应能够通过 `npm install`、`npm run compile` 和 `vsce package`。

---

# 一、核心产品目标

该扩展需要实现类似 VS Code Remote-SSH 的使用体验：

1. 用户可以保存多个 Claude Code API Provider。
2. VS Code 状态栏显示当前选择的 Provider。
3. 点击状态栏后，通过 QuickPick 弹出 Provider 列表。
4. 用户选择 Provider 后，扩展创建一个新的 Claude Code 专用终端。
5. 新终端自动注入该 Provider 所需的环境变量。
6. 新终端自动运行 `claude`。
7. 不修改或关闭其他已有终端。
8. 不尝试修改正在运行的 Claude Code 进程。
9. 不把 API Key 写入普通 JSON 配置文件。
10. API Key 必须使用 VS Code SecretStorage 保存。
11. 支持 Remote-SSH 场景，扩展应运行在 workspace extension host。
12. 多个 Provider 对应的 Claude Code 终端可以同时存在，互不影响。

默认采用“会话隔离模式”：

* 不直接覆盖 `~/.claude/settings.json`
* 不修改 `.bashrc`、`.zshrc`、PowerShell Profile
* 只为扩展新创建的终端设置环境变量
* 每个新终端绑定自己的 Provider

---

# 二、技术要求

使用以下技术栈：

* TypeScript
* VS Code Extension API
* Node.js
* ESLint
* Vitest 或 Mocha
* `@vscode/vsce`
* 不使用 React
* 不使用 Webview 作为 MVP 的主要界面
* 优先使用 VS Code 原生 QuickPick、InputBox、StatusBarItem 和 Command API

项目必须具有清晰的模块划分，避免所有逻辑堆积在 `extension.ts` 中。

建议目录：

```text
claude-code-provider-switcher/
├── src/
│   ├── extension.ts
│   ├── types.ts
│   ├── providerStore.ts
│   ├── providerPicker.ts
│   ├── providerCommands.ts
│   ├── terminalLauncher.ts
│   ├── providerPresets.ts
│   ├── validation.ts
│   └── utils.ts
├── test/
│   ├── providerStore.test.ts
│   ├── terminalLauncher.test.ts
│   └── validation.test.ts
├── media/
│   └── icon.png
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .vscodeignore
├── .gitignore
├── README.md
├── CHANGELOG.md
├── LICENSE
└── SECURITY.md
```

图标可以先放占位说明，不需要生成二进制图片。

---

# 三、数据结构

请定义以下核心数据结构，并根据实际需要合理补充。

```ts
export type ProviderAuthType =
  | "anthropic-auth-token"
  | "anthropic-api-key"
  | "oauth";

export type ClaudeEffortLevel =
  | "low"
  | "medium"
  | "high"
  | "max";

export interface ProviderProfile {
  id: string;
  name: string;
  authType: ProviderAuthType;

  baseUrl?: string;

  model?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  subagentModel?: string;

  effortLevel?: ClaudeEffortLevel;

  createdAt: string;
  updatedAt: string;
}
```

API Key 不允许存储在 `ProviderProfile` 中。

普通 Provider 配置使用：

```ts
context.globalState
```

API Key 使用：

```ts
context.secrets
```

SecretStorage Key 格式：

```text
claude-code-provider-switcher.token.<providerId>
```

当前选中的 Provider ID 使用：

```text
claude-code-provider-switcher.activeProviderId
```

Provider 列表使用：

```text
claude-code-provider-switcher.providers
```

---

# 四、必须实现的功能

## 1. Provider 列表

实现命令：

```text
Claude Code: Select Provider
```

行为：

* 读取已保存的 Provider。
* 使用 QuickPick 展示。
* 当前激活 Provider 前显示勾选标识。
* 每项显示：

  * Provider 名称
  * 当前模型
  * Base URL
* 列表末尾提供：

  * Add Provider
  * Edit Provider
  * Delete Provider
  * Launch Current Provider
  * Reset Built-in Presets

选择某个 Provider 时：

1. 保存为当前 Provider。
2. 更新状态栏。
3. 默认立即启动一个新的 Claude Code 终端。

请允许在设置中控制“选择后是否自动启动”。

配置项：

```json
"claudeCodeProviderSwitcher.launchAfterSelection": {
  "type": "boolean",
  "default": true
}
```

---

## 2. 状态栏

创建左侧状态栏项目。

未选择 Provider 时显示：

```text
$(sparkle) CC: Select Provider
```

已选择 Provider 时显示：

```text
$(sparkle) CC: DeepSeek
```

Tooltip 中显示：

```text
Claude Code Provider
Provider: DeepSeek
Model: deepseek-chat
Base URL: https://api.deepseek.com/anthropic
Click to switch provider
```

状态栏点击命令：

```text
claudeCodeProviderSwitcher.selectProvider
```

---

## 3. 添加 Provider

实现命令：

```text
Claude Code: Add Provider
```

使用 QuickPick 和 InputBox 逐步收集：

1. Provider 名称
2. Auth Type
3. Base URL
4. API Key
5. 默认模型
6. Opus Model
7. Sonnet Model
8. Haiku Model
9. Subagent Model
10. Effort Level

要求：

* Provider 名称不能为空。
* Base URL 必须是合法的 `http` 或 `https` URL。
* API Key 输入框必须启用 password 模式。
* OAuth 类型可以不要求 API Key。
* Provider ID 使用安全且稳定的 UUID。
* 保存后更新 Provider 列表。
* API Key 保存到 SecretStorage。
* 不在任何日志中打印 API Key。

输入流程应支持取消。

取消后：

* 不保存半成品 Provider。
* 不留下孤立 Secret。

---

## 4. 编辑 Provider

实现命令：

```text
Claude Code: Edit Provider
```

要求：

* 用户先选择要编辑的 Provider。
* 每个字段显示当前值。
* API Key 默认不显示原文。
* 提供以下选择：

  * Keep existing API key
  * Replace API key
  * Remove API key
* 修改后更新 `updatedAt`。
* Provider ID 不改变。
* 内置 Preset 也允许编辑，但重置 Preset 时可以恢复默认值。

---

## 5. 删除 Provider

实现命令：

```text
Claude Code: Delete Provider
```

要求：

* 删除前弹出确认框。
* 删除普通配置。
* 同时删除 SecretStorage 中对应 API Key。
* 如果删除的是当前激活 Provider：

  * 清空 activeProviderId
  * 更新状态栏
* 不影响已经运行的终端。

---

## 6. 启动 Claude Code

实现命令：

```text
Claude Code: Launch With Current Provider
```

核心函数类似：

```ts
launchClaudeCode(
  context: vscode.ExtensionContext,
  provider: ProviderProfile
): Promise<void>
```

创建终端：

```ts
vscode.window.createTerminal({
  name: `CC · ${provider.name}`,
  cwd,
  env,
  isTransient: true,
  iconPath: new vscode.ThemeIcon("sparkle")
});
```

工作目录优先级：

1. 当前活动编辑器所属工作区
2. 第一个 workspaceFolder
3. `undefined`

创建终端后：

```ts
terminal.show();
terminal.sendText("claude", true);
```

---

# 五、环境变量规则

启动每个终端前，必须显式清除可能从父进程继承的旧变量，避免从 DeepSeek 切回 Anthropic 时仍然沿用旧配置。

初始环境变量对象应包含：

```ts
const env: Record<string, string | null | undefined> = {
  ANTHROPIC_BASE_URL: null,
  ANTHROPIC_AUTH_TOKEN: null,
  ANTHROPIC_API_KEY: null,
  ANTHROPIC_MODEL: null,
  ANTHROPIC_DEFAULT_OPUS_MODEL: null,
  ANTHROPIC_DEFAULT_SONNET_MODEL: null,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: null,
  CLAUDE_CODE_SUBAGENT_MODEL: null,
  CLAUDE_CODE_EFFORT_LEVEL: null
};
```

然后根据 Provider 配置设置。

Auth Type 映射：

```text
anthropic-auth-token
→ ANTHROPIC_AUTH_TOKEN
```

```text
anthropic-api-key
→ ANTHROPIC_API_KEY
```

```text
oauth
→ 不注入 Token
```

其他字段映射：

```text
baseUrl
→ ANTHROPIC_BASE_URL

model
→ ANTHROPIC_MODEL

opusModel
→ ANTHROPIC_DEFAULT_OPUS_MODEL

sonnetModel
→ ANTHROPIC_DEFAULT_SONNET_MODEL

haikuModel
→ ANTHROPIC_DEFAULT_HAIKU_MODEL

subagentModel
→ CLAUDE_CODE_SUBAGENT_MODEL

effortLevel
→ CLAUDE_CODE_EFFORT_LEVEL
```

不要将不存在的值注入为空字符串，应使用 `null` 或 `undefined` 处理。

---

# 六、内置 Provider Preset

至少提供以下内置模板。

## 1. Anthropic Official

```ts
{
  name: "Anthropic Official",
  authType: "oauth"
}
```

该模板不设置 Base URL，不设置 API Key。

启动时应清除所有第三方 Provider 相关环境变量，让 Claude Code 使用官方登录状态。

## 2. DeepSeek

请内置一个可编辑的 DeepSeek 模板：

```ts
{
  name: "DeepSeek",
  authType: "anthropic-auth-token",
  baseUrl: "https://api.deepseek.com/anthropic"
}
```

模型名称不要强制硬编码为唯一值。

首次添加或重置模板时可以给出示例默认值，但用户必须能够编辑。

例如：

```ts
model: "deepseek-chat"
```

README 中需要提醒：

* Provider 的模型名可能随服务商更新。
* 用户应以对应 Provider 的官方文档为准。

## 3. Custom Anthropic-Compatible Provider

提供空白模板：

```ts
{
  name: "Custom Provider",
  authType: "anthropic-auth-token",
  baseUrl: ""
}
```

---

# 七、Claude CLI 检测

启动前检查系统是否可调用 `claude`。

可以采用以下任一可靠方案：

* `child_process.execFile`
* `child_process.spawn`
* Shell-independent command detection

优先执行：

```text
claude --version
```

要求：

* 设置合理超时。
* 不长时间阻塞扩展。
* 检测失败时提示：

```text
Claude Code CLI was not found.
Install Claude Code and make sure the `claude` command is available in PATH.
```

提供按钮：

```text
Launch Anyway
Cancel
```

不要自动安装 Claude Code。

---

# 八、Remote-SSH 支持

在 `package.json` 中设置：

```json
"extensionKind": [
  "workspace"
]
```

要求：

* 在 Remote-SSH 窗口中，扩展运行在远端扩展宿主。
* 创建的终端运行在远端。
* 工作目录使用远端工作区路径。
* SecretStorage 在不同远端主机上可以分别保存。
* README 中明确说明：

  * 每台 Remote-SSH 主机可能需要重新填写 API Key。
  * Secret 不应自动导出或同步。

---

# 九、VS Code 命令

至少注册以下命令：

```text
claudeCodeProviderSwitcher.selectProvider
claudeCodeProviderSwitcher.addProvider
claudeCodeProviderSwitcher.editProvider
claudeCodeProviderSwitcher.deleteProvider
claudeCodeProviderSwitcher.launchCurrentProvider
claudeCodeProviderSwitcher.resetPresets
```

显示名称：

```text
Claude Code: Select Provider
Claude Code: Add Provider
Claude Code: Edit Provider
Claude Code: Delete Provider
Claude Code: Launch With Current Provider
Claude Code: Reset Built-in Presets
```

---

# 十、快捷键

默认注册：

Windows/Linux：

```text
Ctrl+Alt+M
```

macOS：

```text
Cmd+Alt+M
```

对应命令：

```text
claudeCodeProviderSwitcher.selectProvider
```

---

# 十一、配置项

请在 `package.json` 的 `contributes.configuration` 中加入：

```json
{
  "claudeCodeProviderSwitcher.launchAfterSelection": {
    "type": "boolean",
    "default": true,
    "description": "Launch a new Claude Code terminal after selecting a provider."
  },
  "claudeCodeProviderSwitcher.checkClaudeCliBeforeLaunch": {
    "type": "boolean",
    "default": true,
    "description": "Check whether the Claude Code CLI is available before launching."
  },
  "claudeCodeProviderSwitcher.terminalNameFormat": {
    "type": "string",
    "default": "CC · ${provider}",
    "description": "Terminal name format. Use ${provider} as the provider placeholder."
  }
}
```

终端名称生成逻辑要安全处理非法值和空字符串。

---

# 十二、安全要求

这是本项目的重点。

必须满足：

1. API Key 只保存在 VS Code SecretStorage。
2. Provider 普通配置中不保存 API Key。
3. README、日志、错误消息中不输出 API Key。
4. 导出配置时不包含 API Key。
5. 删除 Provider 时同步删除 SecretStorage。
6. 不修改用户 shell profile。
7. 默认不修改 `~/.claude/settings.json`。
8. 不收集遥测。
9. 不发起与 Provider API 无关的网络请求。
10. 不把密钥传给任何第三方服务。
11. 错误对象中如果可能包含环境变量，需要先脱敏。
12. 不使用 `console.log(provider)`，因为未来数据结构可能意外包含敏感字段。
13. 不把密钥放在 `process.env` 的扩展宿主全局环境中。
14. 只通过 `createTerminal({ env })` 注入目标终端。

创建 `SECURITY.md`，说明：

* 密钥保存方式
* 不进行遥测
* 不上传配置
* 如何报告漏洞
* 用户应避免提交包含密钥的截图或日志

---

# 十三、错误处理

所有命令都必须有错误处理。

实现统一辅助函数，例如：

```ts
showSafeError(error: unknown, fallbackMessage: string): void
```

错误消息不得包含 Token。

以下情况应提供明确提示：

* 没有 Provider
* 没有当前 Provider
* Provider 已不存在
* API Key 缺失
* URL 不合法
* Claude CLI 不存在
* SecretStorage 读取失败
* globalState 写入失败
* 用户取消输入
* 重复 Provider 名称
* 无工作区时启动终端

重复名称可以允许，但应弹出警告并要求用户确认。

---

# 十四、测试要求

请为核心业务逻辑编写测试，至少覆盖：

## providerStore

* 添加 Provider
* 更新 Provider
* 删除 Provider
* 删除时删除 Secret
* 设置 activeProviderId
* 删除 active Provider 后清空 activeProviderId
* Provider ID 保持不变
* API Key 不出现在普通 Provider 数据中

## validation

* 合法 HTTPS URL
* 合法 HTTP URL
* 非法 URL
* 空 URL
* Provider 名称为空
* OAuth 不需要 Token
* Token 类型必须有 Token

## terminalLauncher

将 VS Code API 抽象或 mock，验证：

* 正确映射环境变量
* 从第三方切回 Anthropic 时清除旧变量
* `anthropic-auth-token` 使用 `ANTHROPIC_AUTH_TOKEN`
* `anthropic-api-key` 使用 `ANTHROPIC_API_KEY`
* OAuth 不注入 Token
* 正确生成终端名称
* 正确执行 `claude`

测试不得依赖真实 API Key。

---

# 十五、README 要求

README 使用英文为主，同时提供一个简短中文章节。

必须包含：

1. 项目简介
2. 功能截图占位说明
3. 安装方式
4. 使用方式
5. 添加 DeepSeek Provider 的示例
6. Anthropic Official 的使用方式
7. Remote-SSH 行为
8. SecretStorage 安全说明
9. 不修改 `~/.claude/settings.json`
10. 多 Provider 并行终端说明
11. 常见问题
12. Claude CLI 未找到的处理方式
13. 如何从 VSIX 安装
14. 如何开发
15. 如何运行测试
16. 如何打包
17. 如何发布 Marketplace
18. 已知限制
19. 许可证

已知限制中说明：

* 正在运行的 Claude Code 会话不能原地热切换 Provider。
* 切换意味着启动一个新的终端和新的 Claude Code 进程。
* Provider 模型名称可能随服务商变化。
* 某些 Anthropic-compatible API 不一定完整兼容 Claude Code。

---

# 十六、package.json 要求

必须正确配置：

```json
{
  "main": "./dist/extension.js",
  "extensionKind": ["workspace"],
  "activationEvents": [
    "onCommand:claudeCodeProviderSwitcher.selectProvider",
    "onCommand:claudeCodeProviderSwitcher.addProvider",
    "onCommand:claudeCodeProviderSwitcher.editProvider",
    "onCommand:claudeCodeProviderSwitcher.deleteProvider",
    "onCommand:claudeCodeProviderSwitcher.launchCurrentProvider",
    "onCommand:claudeCodeProviderSwitcher.resetPresets"
  ]
}
```

补充：

* commands
* keybindings
* configuration
* categories
* keywords
* repository
* bugs
* license
* scripts

建议 scripts：

```json
{
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "lint": "eslint src test",
  "test": "vitest run",
  "test:watch": "vitest",
  "vscode:prepublish": "npm run lint && npm run test && npm run compile",
  "package": "vsce package",
  "publish": "vsce publish"
}
```

请选择合理且互相兼容的依赖版本。

---

# 十七、代码质量要求

1. 启用 TypeScript strict。
2. 禁止大量使用 `any`。
3. 公共函数写清晰的类型声明。
4. 核心逻辑与 VS Code UI 解耦。
5. 不在模块导入时执行副作用。
6. 使用依赖注入或薄封装提高可测试性。
7. 所有 Disposable 都加入 `context.subscriptions`。
8. 所有异步调用正确 `await`。
9. 不吞掉错误。
10. 不使用同步文件 I/O。
11. 不修改用户 Claude 配置文件。
12. 不创建不必要的后台进程。
13. 不加入遥测 SDK。
14. 不依赖未维护的小众 npm 包。
15. 注释用于解释设计原因，而不是重复代码内容。

---

# 十八、交付方式

请按照以下顺序执行：

1. 先检查当前目录是否已经存在 VS Code 扩展项目。
2. 如果不存在，创建完整项目。
3. 如果存在，先阅读现有代码后再修改，不要盲目覆盖用户代码。
4. 输出并创建所有必要文件。
5. 安装依赖。
6. 运行 lint。
7. 运行测试。
8. 运行 TypeScript 编译。
9. 修复所有错误。
10. 尝试执行 VSIX 打包。
11. 最后给出简洁总结。

最终总结必须包含：

```text
Implemented:
- ...

Validation:
- npm run lint: passed/failed
- npm test: passed/failed
- npm run compile: passed/failed
- npm run package: passed/failed

Main commands:
- ...

Known limitations:
- ...
```

不要声称测试通过，除非实际运行成功。

---

# 十九、MVP 优先级

如果完整功能无法一次完成，优先保证以下 MVP 完整可用：

1. Provider 数据结构
2. globalState 持久化
3. SecretStorage 保存 API Key
4. Add Provider
5. Select Provider
6. 状态栏
7. 独立终端启动
8. 环境变量隔离
9. Anthropic Official Preset
10. DeepSeek Preset
11. Remote-SSH workspace extension
12. README
13. 编译成功
14. 可打包 VSIX

不要优先开发 Webview、云同步、用量统计、复杂图形界面或全局配置文件覆写功能。
