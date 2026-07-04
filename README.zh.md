# Claude Code Provider Switcher

[English](README.md) | [中文文档](README.zh.md)

一个 VS Code 扩展，让你在 Anthropic、DeepSeek、智谱 GLM、Kimi、通义千问、MiniMax 等 AI 服务商之间一键切换 —— 并内置 **多模型协作工作流引擎**，支持代码自动执行、评审循环、LaTeX 论文生成。

## 功能亮点

- **多服务商切换** — 保存配置、侧边栏下拉切换、`Ctrl+Alt+M` 快捷键，每次启动注入独立环境变量。
- **技能（Skills）管理** — 从 GitHub 导入技能、一键切换活跃技能、分组管理。
- **多模型协作工作流** — 把多个模型串成流水线，每步用不同模型 + 技能 + 提示，支持 `{{task}}` / `{{previous}}` 模板变量。
- **评审循环（Review Loop）** — 当评审员（如代码测试员、同行评审）判定不合格时，自动退回指定步骤并重跑，直到通过或达到最大轮数。
- **代码自动执行** — 从步骤输出中提取 Python 代码，写入磁盘，执行，将运行结果（标准输出、错误、生成的数据文件）传递给下一步。
- **LaTeX 论文生成** — 提供含 `{{BODY}}` 占位符的 `.tex` 模板，工作流自动填入内容并写入 `paper/main.tex`，自动尝试 pdflatex 编译。
- **实时运行看板** — 工作流运行时弹出 webview 面板，实时显示流水线状态、每步输出、循环迭代、自动保存/复制报告。
- **权限模式** — 侧边栏下拉切换正常审批 / 免审批模式。
- **会话历史** — 浏览和恢复过去的 Claude Code 会话。
- **Remote-SSH** — 以 workspace 扩展模式在远端主机运行。

## 快速安装

1. 从 [最新 Release](https://github.com/YOUR_USERNAME/claude-code-provider-switcher/releases) 下载 `.vsix`。
2. VS Code → 扩展面板 → `...` → **从 VSIX 安装…** → 选择文件。
3. `Ctrl+Shift+P` → `Reload Window`。

或从源码构建：
```bash
npm install && npm run compile && npm run package
```

## 快速开始

1. 点左侧活动栏的 **Claude Code** 图标（✨），打开侧边栏。
2. 在 **Claude Code Providers** 面板下拉中选择服务商（如 DeepSeek）。
3. 粘贴 API Key，点 **Save Key**。
4. 选择后自动启动 Claude Code 终端（可在设置中关闭）。

## 核心功能

### 服务商管理

- 侧边栏下拉选 Provider，粘贴 Key 存好
- 内置预设：Anthropic Official、DeepSeek、智谱 GLM、Kimi、通义千问、MiniMax
- 可新增/编辑/删除自定义 Provider
- **权限模式**下拉：Request Approval / Full Access

### 技能管理

- 侧边栏 **Claude Code Skills** 树视图
- 点技能 = 切换活跃（⭐ 标记），再点 = 取消活跃
- inline 按钮安装/卸载后台技能
- ☁ 按钮从 GitHub 导入技能
- 支持技能分组

技能默认放在 `~/.claude/skills/`，其他路径通过 `Claude Code: Open Skill Config` 管理。

### 工作流

侧边栏 **Claude Code Workflows** 树视图。工作流 = 一串有序步骤，每步：

- 调用一个 Provider + Model
- 可选注入一个 Skill（其 `SKILL.md` 作为 system prompt）
- 有 Prompt，支持 `{{task}}`（原始任务）和 `{{previous}}`（上一步输出）

**创建工作流**：点 `+` 打开可视化编辑器（webview），填步骤 → 保存。

**运行工作流**：点 ▶，输入任务，自动弹窗选择输出文件夹，流水线逐步执行，看板实时显示。

**代码执行**：步骤勾选「Execute code」，模型生成 Python 代码后自动写入文件并执行，stdout/stderr/生成的数据文件回传给下一步评审。

**LaTeX 模板**：步骤设置 templatePath（指向含 `{{BODY}}` 的 .tex 文件），模型输出自动填入并生成 `paper/main.tex`。

**评审循环**：在编辑器中启用 loop，设定「退回起点」和「评审步骤」以及最大轮数。评审输出 `Decision: REVISE` 即退回重做。

### 一键复现科研工作流

在 **Claude Code Skills** 面板先导入两个 GitHub 技能仓库：
```
https://github.com/Imbad0202/academic-research-skills
https://github.com/K-Dense-AI/scientific-agent-skills
```

然后在本文件夹运行（需要 Node.js）：
```bash
node scripts/research-workflow-save.cjs
```

会生成一条 8 角色、2 循环的「科研 Vibe Coding 协作流水线 v2」，含代码执行。

## 配置项

在 VS Code 设置中搜索 `claudeCodeProviderSwitcher.*`：

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `launchAfterSelection` | `true` | 选 Provider 后自动启动终端 |
| `checkClaudeCliBeforeLaunch` | `true` | 启动前检查 `claude --version` |
| `terminalNameFormat` | `CC · ${provider}` | 终端名称格式 |
| `terminalLocation` | `editor` | `editor` 或 `panel` |
| `conversationMode` | `fresh` | `fresh` / `continue` / `resumePicker` |
| `permissionMode` | `requestApproval` | `requestApproval` / `fullAccess` |
| `claudeExecutablePath` | `""` | 手动指定 claude 路径（Windows 自动检测失败时用） |

## 配置文件位置

| 文件 | 用途 |
|------|------|
| `~/.claude-code-provider-switcher/config.json` | Provider 配置和 API Key |
| `~/.claude-code-provider-switcher/skills.json` | 技能配置 |
| `~/.claude-code-provider-switcher/workflows.json` | 工作流定义 |
| `~/.claude-code-provider-switcher/runs/` | 自动保存的运行报告 |

## 安全

- API Key 存于 `config.json`。扩展不上传数据、不收集遥测、不改 shell profile、不改 `~/.claude/settings.json`
- 环境变量只注入到扩展创建的终端，不影响其他终端

## 命令清单

- `Claude Code: Select / Add / Edit / Delete Provider`
- `Claude Code: Launch With Current Provider`
- `Claude Code: Import Skill from GitHub`
- `Claude Code: Toggle Active Skill` / `Clear Active Skill`
- `Claude Code: New / Edit / Run Workflow`
- 更多命令按 `Ctrl+Shift+P` 搜 `Claude Code:` 即可

## 开发

```bash
npm install
npm run lint
npm test
npm run compile
# VS Code 中按 F5 启动扩展开发宿主
```

## License

MIT
