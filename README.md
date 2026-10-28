# Claude Code Provider Switcher

Claude Code Provider Switcher is a VS Code extension for switching Claude Code between Anthropic Official, DeepSeek, and other Anthropic-compatible API providers without editing shell profiles.

Chat with Claude Code in the extension sidebar using the selected provider. The extension runs the Claude Code CLI with that provider's environment and presents responses, tool activity, and permission requests in the sidebar. A terminal launch remains available as an alternative.

## 侧边栏使用

打开活动栏中的 Claude Code 图标，在聊天区域选择 Provider，输入消息后按 Enter 发送，Shift+Enter 换行。回复过程中可以停止生成；需要授权时可在聊天区域批准或拒绝工具操作。使用顶部的历史按钮打开会话列表，新建按钮开始新会话。历史会话会使用当前选择的 Provider 继续。

最近的会话显示在聊天顶部，点击“查看全部”展开。顶部齿轮提供 Provider 和权限、技能、工作流与提示词设置；打开管理面板后可用面板标题栏的关闭按钮收起。输入框底部的模型按钮支持选择已配置的模型、手动输入模型 ID，或按需加载 Provider 的模型列表；选择对后续消息生效。

工具操作以可展开的摘要卡片显示；点击卡片可查看命令、文件内容、参数和 Claude Code 返回的结果。失败会单独标记，未收到结果时不会显示为成功。聊天滚动到较早位置时，新内容不会强制将页面拉回底部。

当模型通过 Claude Code 返回思考内容时，侧边栏会实时显示思考卡片；结束后自动折叠，可点击展开，历史对话也能查看已保存的思考。部分模型或 Provider 不返回思考文本，此时会显示等待状态。回复速度受模型和 Provider 影响，可在 Provider 的高级设置中调整思考强度。

同一对话会复用后台 Claude Code 进程，无需每条消息重新启动。切换模型、Provider 或其他影响 CLI 的设置后，下一条消息会重新启动进程并恢复当前会话，继续使用已有上下文；新建对话则开始新的上下文。

工具卡片和聊天交互参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的开源前端设计，并针对 VS Code 侧边栏及 Claude Code 事件格式实现。

点击聊天顶部的齿轮设置常用提示词及自动插入位置。输入框内按 **Ctrl+Alt+P**（macOS：**Cmd+Option+P**），或点击输入框下方的加号，可在光标位置插入；也可以选择每次发送时自动添加到消息头部或尾部。自动插入默认关闭。

需要安装 Claude Code CLI，并在使用工作区工具前信任当前工作区。终端模式可通过输入框下方按钮或命令 `Claude Code: Open in Terminal` 打开。

## Screenshot

Screenshot placeholder: add marketplace screenshots under `media/` before publishing.

## Features

- Save multiple provider profiles.
- Show the active provider in the VS Code status bar.
- Switch providers with QuickPick or `Ctrl+Alt+M` / `Cmd+Alt+M`.
- Chat in the sidebar with streaming responses and tool permission prompts; optionally launch Claude Code in a terminal.
- Store provider profiles and API keys in `~/.claude-code-provider-switcher/config.json` so new windows and helper scripts can reuse them.
- Keep multiple provider-specific Claude Code terminals running side by side when using terminal mode.
- Start new Claude Code sessions by default, with optional resume/continue modes for existing history.
- Keep the Claude Code Side Bar focused on one provider dropdown; edit advanced provider, token, and model settings in the config file.
- Show Claude Code conversation history in the dedicated Claude Code Side Bar and resume a session with the active provider.
- Install multiple Claude Code skills for new sessions, import skills from GitHub, and organize them into groups.
- Support Remote-SSH by running as a workspace extension.

## Installation

From source:

```bash
npm install
npm run compile
npm run package
```

Then install the generated VSIX:

```bash
code --install-extension claude-code-provider-switcher-*.vsix
```

## Usage

1. Open the Claude Code Side Bar from the Activity Bar, or run `Claude Code: Open Sidebar`.
2. Pick an existing provider from `Claude Code Providers`, or run `Claude Code: Add Provider`.
3. Select a provider from the Side Bar dropdown to make it active.
4. If the provider needs credentials, paste the API key/token in the Side Bar and click `Save Key`.
5. The extension starts a new isolated Claude Code session with that provider's environment when `launchAfterSelection` is enabled.

Provider profiles, the active provider id, and saved API keys are stored in:

```text
~/.claude-code-provider-switcher/config.json
```

Run `Claude Code: Open Provider Config` to edit that file directly. `Claude Code: Add Provider`, `Claude Code: Edit Provider`, and `Claude Code: Delete Provider` also update it. Older `tokens.json` and VS Code SecretStorage entries are migrated into `config.json` when the extension reads them.

The extension does not modify existing terminals. Running Claude Code sessions cannot be hot-switched in place; switching means launching a new terminal and a new Claude Code process.

If you type `claude --continue` directly in an ordinary terminal, Claude Code will use its normal Anthropic configuration unless that terminal already has provider environment variables. In this workspace, the included `claude.cmd` wrapper routes that command through the active provider and falls back to a fresh session when no local Claude Code history exists.

By default, each new terminal runs:

```bash
claude
```

That starts a fresh session and avoids `No conversation found to continue` on first launch. You can change this behavior with `claudeCodeProviderSwitcher.conversationMode`, or resume a specific item from `Claude Code History`.

## Manual DeepSeek CLI Launch

For a normal Windows terminal outside the extension, use:

```powershell
.\scripts\claude-deepseek.cmd
```

The script uses `DEEPSEEK_API_KEY` first, then reads the DeepSeek key and model settings from `~/.claude-code-provider-switcher/config.json`. If no key is saved, it prompts once and writes the key back to that config file.

```powershell
.\scripts\claude-deepseek.cmd
```

You can pass different Claude Code arguments after the script name:

```powershell
.\scripts\claude-deepseek.cmd --resume
.\scripts\claude-deepseek.cmd --continue
```

Avoid pasting API keys into command history. Prefer the prompt, the extension config file, or a local environment variable that you manage yourself.

## Side Bar Conversation History

The dedicated Claude Code Side Bar includes a `Claude Code History` view. It scans Claude Code's local session files under:

```text
~/.claude/projects/**/*.jsonl
```

When history exists, each item shows a conversation title, project, and session id. Click an item to run:

```bash
claude --resume <sessionId>
```

The resumed terminal uses the currently selected provider, so the same Claude Code conversation can be resumed through a different API provider. If the view is empty, start at least one Claude Code conversation first and then click refresh.

## Side Bar Skill Management

The dedicated Claude Code Side Bar also includes a `Claude Code Skills` view. It supports multiple installed skills, GitHub imports, and user-defined groups. It scans downloaded skills from:

```text
~/.claude/skills/*
<workspace>/.claude/skills/*
~/.claude-code-provider-switcher/skills.json
<workspace>/.claude-code-provider-switcher/skills.json
```

Put downloaded skills under `~/.claude/skills/<skill-name>/` or `<workspace>/.claude/skills/<skill-name>/` to have them discovered automatically. Use the `Import Skill from GitHub` title button to clone a GitHub repository into `~/.claude/skills`; the import flow asks whether to install it for new sessions immediately.

For custom locations, run `Claude Code: Open Skill Config` from the Command Palette. The extension creates:

```text
<workspace>/.claude-code-provider-switcher/skills.json
```

If no workspace is open, it creates:

```text
~/.claude-code-provider-switcher/skills.json
```

Example config:

```json
{
  "skillRoots": [
    "~/.claude/skills",
    "../.claude/skills",
    "E:/DownloadedClaudeSkills"
  ],
  "skills": [
    {
      "name": "My Custom Skill",
      "directory": "E:/DownloadedClaudeSkills/my-custom-skill",
      "description": "Optional display text."
    }
  ],
  "installedSkillDirectories": [
    "E:/DownloadedClaudeSkills/my-custom-skill"
  ],
  "groups": [
    {
      "id": "review",
      "name": "Review",
      "skillDirectories": [
        "E:/DownloadedClaudeSkills/my-custom-skill"
      ]
    }
  ]
}
```

`skillRoots` points to folders that contain many skill folders. `skills` registers individual skill folders. `installedSkillDirectories` controls the skills loaded into new sessions. `groups` stores named collections that can install all included skills in one click. Relative paths are resolved from the directory containing `skills.json`.

Click a skill row to toggle it as the **active skill** — the skill Claude will auto-apply in new sessions. Activating a skill installs it and marks it with a $(star-full) star; clicking the starred skill again **deactivates** it (the star clears). Background-installed skills keep loading as slash commands whether starred or not.

Clicking a skill **does not** open a new terminal by itself — the info message offers a "Launch Now" button so you can start a session immediately if you want. Launch a provider from the Side Bar or run `Claude Code: Launch With Current Provider` whenever you are ready.

Every installed skill is passed as `--plugin-dir` to new sessions. The active (starred) skill also receives an `--append-system-prompt` that tells Claude to use it automatically for relevant requests:

```bash
claude --plugin-dir "<skillA>" --plugin-dir "<skillB>" --append-system-prompt "..."
```

Use the inline install / uninstall buttons to manage the `Installed Skills` list without changing the active skill. Click the title-bar `$(circle-slash)` button or run `Claude Code: Clear Active Skill` to remove the active skill while keeping all background skills loaded. Use `Clear Installed Skills` on the `Installed Skills` row to make new Claude Code terminals run entirely without skills:

```bash
claude ...
```

Use `Reinstall Skill` from the right-click menu to refresh a GitHub-imported skill from its `sourceUrl`.

This remains session-scoped. The extension does not run `claude plugin enable` or `claude plugin disable`; it only passes repeatable `--plugin-dir` arguments when launching a new Claude Code terminal.

## Multi-Model Workflows

The `Claude Code Workflows` view lets you chain multiple models and skills into a reusable pipeline. Each **workflow** is an ordered list of **steps**; each step calls one provider+model, optionally loads a skill, and feeds its output to the next step.

A step's **prompt** supports two template tokens:

- `{{task}}` — the original task you enter when running the workflow
- `{{previous}}` (or `{{input}}`) — the output of the previous step (empty for the first step)
- `{{iteration}}` — the current review-loop iteration, starting at `1`
- `{{review}}` — the latest review feedback during a review loop
- `{{artifact}}` — the latest artifact that was sent to the review step

So a 3-step pipeline can run `deepseek-v4-pro` (research) → `deepseek-v4-flash` (draft) → `deepseek-v4-pro` (review), with each model seeing the previous model's output and an optional skill shaping its behavior.

### Review loops

Workflows can optionally enable a **review loop**. Pick a **revision start step**, a **review step**, and a maximum number of review attempts. If the review output is not approved, the runner sends a revision context back to the revision start step and reruns every step through the review step.

For reliable approval detection, make the review prompt start with a machine-readable decision line:

```text
Decision: APPROVED
```

or:

```text
Decision: REVISE
```

By default, only clear approval markers such as `Decision: APPROVED`, `Decision: ACCEPTED`, `Decision: PASS`, `最终决定：接受`, or `最终决定：通过` end the loop. Minor revision, major revision, rejection, or any unrecognized review output triggers another revision pass until the configured limit is reached. You can override this with a custom approval regex in the workflow editor.

### Creating a workflow

1. Click `+` in the `Claude Code Workflows` view title, or run `Claude Code: New Workflow`.
2. In the editor that opens: name the workflow, then add steps. For each step pick a **Provider**, a **Model** (loaded live from the provider's API), an optional **Skill** (its `SKILL.md` is injected as that step's system prompt), and a **Prompt**.
3. Reorder steps with ↑ / ↓, remove with ✕, then **Save Workflow**.

Workflows are stored in:

```text
~/.claude-code-provider-switcher/workflows.json
```

### Running a workflow

Click the ▶ button on a workflow (or right-click → `Run Workflow`). Enter the task, and the extension runs each step in order with a progress notification, calling each step's model directly via the OpenAI-compatible chat API. When finished it opens a **markdown report** showing every step's model, skill, prompt, and output, plus the final result.

How a step is executed:

- The skill's `SKILL.md` (or `README.md`) is read in full and sent as a `system` message.
- The rendered prompt is sent as the `user` message.
- The step's model overrides the provider's default model for that call.
- If a review loop is enabled, a failed review reruns the configured revision range instead of stopping at the review output.
- If a step errors, the run stops and the report shows which step failed.

This is a direct-API pipeline (not a Claude Code terminal), so it works with any provider that exposes an OpenAI-compatible `/chat/completions` endpoint and a saved API key.

## Built-in Provider Presets

The extension includes editable presets for Anthropic Official and several Anthropic-compatible providers:

| Provider | Auth type | Base URL | Example model |
| --- | --- | --- | --- |
| Anthropic Official | `oauth` | Anthropic default | Claude Code official login |
| 智谱 GLM | `anthropic-auth-token` | `https://open.bigmodel.cn/api/anthropic` | `glm-5.2[1m]` |
| DeepSeek | `anthropic-auth-token` | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro[1m]` |
| Kimi | `anthropic-auth-token` | `https://api.moonshot.cn/anthropic` | `kimi-k2.7-code` |
| 通义千问 / 阿里云百炼 | `anthropic-auth-token` | `https://dashscope.aliyuncs.com/apps/anthropic` | `qwen3.6-plus` |
| MiniMax | `anthropic-auth-token` | `https://api.minimaxi.com/anthropic` | `MiniMax-M3[1m]` |
| Custom Provider | `anthropic-auth-token` | empty | empty |

The presets remain editable in `~/.claude-code-provider-switcher/config.json`. Claude Code's built-in `/model` command is the preferred way to change the active model during a session; use the config file only for provider defaults and environment variables.

## Anthropic Official

The Anthropic Official preset uses OAuth and does not inject a token or base URL. When launched, third-party Claude-related environment variables are explicitly cleared so Claude Code can use the official login state.

## Remote-SSH

The extension declares:

```json
"extensionKind": ["workspace"]
```

In Remote-SSH windows, it runs in the remote extension host and creates terminals on the remote machine. The provider config file is stored on that host, so each remote host may require entering API keys again. Secrets should not be exported, committed, or synchronized automatically.

## Security

API keys are stored in `~/.claude-code-provider-switcher/config.json` under the `tokens` object. The extension does not collect telemetry, upload configuration, modify shell profiles, or overwrite `~/.claude/settings.json`.

## Parallel Terminals

Each provider launch creates a new terminal with its own environment. You can keep Anthropic, DeepSeek, and custom provider terminals open at the same time.

## Claude CLI Not Found

Before launch, the extension can run:

```bash
claude --version
```

If Claude Code CLI is not found, install Claude Code and ensure `claude` is available in `PATH`. You can choose `Launch Anyway` if your terminal environment resolves `claude` differently.

## Settings

- `claudeCodeProviderSwitcher.launchAfterSelection`: launch a terminal immediately after selecting a provider.
- `claudeCodeProviderSwitcher.checkClaudeCliBeforeLaunch`: check `claude --version` before launching.
- `claudeCodeProviderSwitcher.terminalNameFormat`: customize terminal names with `${provider}`.
- `claudeCodeProviderSwitcher.terminalLocation`: open new Claude Code terminals in the editor area (`editor`, default) or terminal panel (`panel`).
- `claudeCodeProviderSwitcher.conversationMode`: choose `fresh` to start a new conversation, `continue` to share the most recent workspace conversation across API switches, or `resumePicker` to open Claude Code's resume picker.
- `claudeCodeProviderSwitcher.permissionMode`: choose `requestApproval` for normal Claude Code approvals or `fullAccess` to launch with `--permission-mode bypassPermissions`.

## Commands

- `Claude Code: Select Provider`
- `Claude Code: Add Provider`
- `Claude Code: Edit Provider`
- `Claude Code: Delete Provider`
- `Claude Code: Launch With Current Provider`
- `Claude Code: Reset Built-in Presets`
- `Claude Code: Open Sidebar`
- `Claude Code: Open Provider Config`
- `Claude Code: Refresh Conversation History`
- `Claude Code: Resume Conversation`
- `Claude Code: Refresh Skills`
- `Claude Code: Open Skill Config`
- `Claude Code: Select Active Skill`
- `Claude Code: Clear Active Skill`
- `Claude Code: Import Skill from GitHub`
- `Claude Code: Install Skill`
- `Claude Code: Uninstall Skill`
- `Claude Code: Reinstall Skill`
- `Claude Code: Clear Installed Skills`
- `Claude Code: New Skill Group`
- `Claude Code: Rename Skill Group`
- `Claude Code: Delete Skill Group`
- `Claude Code: Add Skill To Group`
- `Claude Code: Remove Skill From Group`
- `Claude Code: Move Skill To Group`
- `Claude Code: New Workflow`
- `Claude Code: Edit Workflow`
- `Claude Code: Duplicate Workflow`
- `Claude Code: Delete Workflow`
- `Claude Code: Run Workflow`
- `Claude Code: Refresh Workflows`

## Development

```bash
npm install
npm run lint
npm test
npm run compile
```

Open the folder in VS Code and press `F5` to launch an Extension Development Host.

## Packaging

```bash
npm run package
```

## Publishing

Update `publisher`, `repository`, `bugs`, screenshots, and marketplace assets, then run:

```bash
vsce login <publisher>
npm run publish
```

## FAQ

**Does this edit `~/.claude/settings.json`?**  
No. The MVP uses session-isolated terminal environment variables only.

**Can it switch a running Claude Code session in place?**  
No. It launches a new terminal and process for the selected provider.

**Can multiple providers share conversation history?**  
Yes. Change `claudeCodeProviderSwitcher.conversationMode` to `continue`, or click a conversation in `Claude Code History`.

**Can I resume a specific conversation from the Side Bar?**  
Yes. Use the `Claude Code History` view in the Claude Code Side Bar. Select a provider first, then click a history item.

**Can I switch Claude Code skills from the Side Bar?**  
Yes. Use `Claude Code Skills` in the Claude Code Side Bar. Click a skill to toggle it as the active (starred) skill; click it again to deactivate it. Background-installed skills load as slash commands for every new session regardless of which skill is active. Use `Clear Active Skill` from the title bar or right-click menu to cancel the active skill without affecting installed background skills, or `Clear Installed Skills` to remove everything.

**Where should downloaded skills go?**  
Use `~/.claude/skills/<skill-name>/` or `<workspace>/.claude/skills/<skill-name>/`. You can also import from GitHub with the Side Bar button. For any other folder, add it through `Claude Code: Open Skill Config`.

**Are API keys stored in `settings.json`?**  
No. They are stored in `~/.claude-code-provider-switcher/config.json` so the extension and the DeepSeek helper script can reuse the same saved key.

**Will all Anthropic-compatible APIs work?**  
Not necessarily. Some providers may not fully match Claude Code expectations.

## Known Limitations

- Running Claude Code sessions cannot be hot-switched in place.
- Switching providers starts a new terminal and a new Claude Code process.
- Shared history depends on Claude Code's own session persistence and local `~/.claude/projects` JSONL files. Avoid sending turns from two terminals into the same resumed conversation at the same time.
- Skill loading is session-scoped through repeatable `--plugin-dir`; it does not install, update, enable, or disable global Claude Code plugins. Built-in slash commands such as `/model` remain available by default.
- The provider, history, and skill controls live in a dedicated Claude Code Side Bar. The Claude Code CLI process still runs in an isolated terminal because VS Code does not support embedding a native terminal directly inside the left Side Bar.
- Provider model names may change over time.
- Some Anthropic-compatible APIs may not be fully compatible with Claude Code.

## 中文简介

Claude Code Provider Switcher 可以在 Anthropic Official、智谱 GLM、DeepSeek、Kimi、通义千问 / 阿里云百炼、MiniMax 和其他 Anthropic-compatible Provider 之间切换。默认启动 `claude --continue`，因此同一工作区内切换 API 时可以延续最近一次 Claude Code 对话历史。Explorer 侧边栏会显示 `Claude Code History`，可点击某条历史并用当前 Provider 执行 `claude --resume <sessionId>`。侧边栏也会显示 `Claude Code Skills`，点击技能可以切换（toggle）活跃技能 —— 激活后新会话会自动使用该技能，再次点击同一个技能可以取消激活；还可以通过 inline 按钮安装多个后台技能、从 GitHub 导入、或按组管理。使用标题栏的清除按钮或 `Claude Code: Clear Active Skill` 命令可以取消活跃技能而不影响已安装的后台技能。skill 默认放在 `~/.claude/skills/<skill-name>/` 或 `<workspace>/.claude/skills/<skill-name>/`，其他位置可通过 `Claude Code: Open Skill Config` 管理。它不会修改 `~/.claude/settings.json` 或 shell profile，而是为每次启动的新终端单独注入环境变量。API Key 保存到 `~/.claude-code-provider-switcher/config.json`，扩展和 DeepSeek 脚本会从这里读取。Remote-SSH 场景下，每台远端主机可能需要单独填写密钥。

## License

MIT
