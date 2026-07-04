# Claude Code Provider Switcher

[中文文档](README.zh.md) | [English](README.md)

A VS Code extension that lets you switch Claude Code between Anthropic, DeepSeek, GLM, Kimi, Qwen, MiniMax and other Anthropic-compatible providers — plus a **multi-model collaborative workflow engine** with code execution, review loops, and LaTeX paper generation.

## Features

- **Multi-provider switching** — save profiles, switch with a dropdown or `Ctrl+Alt+M`, launch isolated terminals with provider-specific environment variables.
- **Skills management** — install skills from GitHub, toggle active skills, organize into groups.
- **Multi-model workflows** — chain models into sequential pipelines where each step uses a different model, skill, and prompt. Supports `{{task}}` and `{{previous}}` templating for context passing.
- **Review loops** — configure self-correcting review cycles. When a reviewer (e.g., code tester, peer reviewer) rejects the output, the pipeline rewinds, revises, and reruns — up to a configurable maximum.
- **Code execution** — extract Python code from step outputs, write it to disk, execute it, and feed the results (stdout, stderr, generated files) forward to the next step.
- **LaTeX paper generation** — provide a `.tex` template with `{{BODY}}` placeholder; the workflow fills it and writes `paper/main.tex`. pdflatex compilation is attempted automatically.
- **Live run dashboard** — a real-time webview panel showing the pipeline map, step-by-step outputs, loop iterations, and a summary with save/copy buttons.
- **Permission mode** — toggle between normal approval and full-access bypass from the sidebar.
- **Conversation history** — browse and resume past Claude Code sessions.
- **Remote-SSH** — runs as a workspace extension on remote hosts.

## Quick Install

1. Download `claude-code-provider-switcher-0.1.0.vsix` from the [latest release](https://github.com/YOUR_USERNAME/claude-code-provider-switcher/releases).
2. In VS Code: Extensions panel → `...` → **Install from VSIX…** → select the file.
3. `Ctrl+Shift+P` → `Reload Window`.

Or build from source:
```bash
npm install && npm run compile && npm run package
```

## Quick Start

1. Open the **Claude Code** sidebar (sparkle icon in the Activity Bar).
2. Select a provider (e.g., DeepSeek) from the dropdown.
3. Paste your API key and click **Save Key**.
4. The extension launches Claude Code with that provider's environment. Use `Core Features → Providers` to fine-tune.

## Core Features

### Providers

The **Claude Code Providers** panel in the sidebar shows a dropdown with all saved providers. Select one to make it active, then:
- Paste and save your API key (stored in `~/.claude-code-provider-switcher/config.json`)
- Toggle **Permission Mode** between `Request Approval` and `Full Access`
- The extension launches a new terminal with the provider's environment variables

Built-in presets: Anthropic Official, DeepSeek, 智谱 GLM, Kimi, 通义千问, MiniMax, and a blank Custom slot.

### Skills

The **Claude Code Skills** tree lists all discovered skills. Click a skill to toggle it as the **active skill** (starred — auto-applied in new sessions); click again to deactivate. Use inline buttons to install/uninstall background skills, import from GitHub, or organize into groups.

Skills are loaded from `~/.claude/skills/` and `skills.json`.

### Workflows

The **Claude Code Workflows** tree shows saved workflows. A workflow is an ordered chain of **steps**, each:
- Calls one provider + model
- Optionally injects a skill (its `SKILL.md` becomes the system prompt)
- Has a prompt that supports `{{task}}` (the original task) and `{{previous}}` (the output of the previous step)

Click **+** to open the visual editor (webview form), or use `Claude Code: New Workflow`. Click **▶** to run — a live dashboard opens showing the pipeline in action, and the run report is saved to disk.

**Code execution**: check **Execute generated code** on a step. The runner extracts Python code blocks from the chat output, writes them to a project directory, executes them, and feeds the execution results (stdout, stderr, newly generated data/figures) to the next step.

**LaTeX template filling**: set a `templatePath` on a step. The template should contain `{{BODY}}`. The step's full chat output is inserted at `{{BODY}}`, the result is written to `paper/main.tex`, and `pdflatex` is attempted.

**Review loops**: enable loops in the workflow editor. Pick a revision-start step and a review step. If the review output says `Decision: REVISE`, the pipeline rewinds to the revision-start step. Set a max number of iterations.

## Configuration

All settings under `claudeCodeProviderSwitcher.*`:

| Setting | Default | Description |
|---------|---------|-------------|
| `launchAfterSelection` | `true` | Launch a terminal immediately after selecting a provider |
| `checkClaudeCliBeforeLaunch` | `true` | Run `claude --version` before launching |
| `terminalNameFormat` | `CC · ${provider}` | Terminal name template |
| `terminalLocation` | `editor` | `editor` or `panel` |
| `conversationMode` | `fresh` | `fresh`, `continue`, or `resumePicker` |
| `permissionMode` | `requestApproval` | `requestApproval` or `fullAccess` |
| `claudeExecutablePath` | `""` | Set manually if auto-detect fails (helpful on Windows) |

## Config Files

| File | Purpose |
|------|---------|
| `~/.claude-code-provider-switcher/config.json` | Provider profiles and saved API keys |
| `~/.claude-code-provider-switcher/skills.json` | Skill configuration |
| `~/.claude-code-provider-switcher/workflows.json` | User-defined workflows |
| `~/.claude-code-provider-switcher/runs/` | Auto-saved workflow run reports |

## Security

- API keys are stored in `config.json`. No telemetry, no uploads, no shell profile modifications.
- The extension does NOT modify `~/.claude/settings.json`.
- Use provider-specific environment variables injected into new terminals only.
- For production use, consider rotating keys regularly.

## Development

```bash
npm install
npm run lint
npm test
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

## License

MIT

## 完整使用文档

参见仓库中的 `安装使用说明.md`（中文）for a step-by-step guide covering installation, skills setup, workflow creation, and the research workflow reproduction script.
