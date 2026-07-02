# Qific Butler

<p align="center">
  <img src="src/assets/brand/app-icon.png" alt="Qific Butler logo" width="128" height="128" />
</p>

<p align="center">
  <strong>让 AI 成为真正懂你电脑的管家。</strong><br />
  <strong>An AI butler that understands your computer.</strong>
</p>

<p align="center">
  <a href="https://github.com/richyhu/Qific_Butler">GitHub Repository</a>
  · Version 0.1.0
  · GPL-3.0
</p>

Qific Butler 是一个运行在本机的 AI 桌面管家。它把系统监控、文件发现、AI 诊断和安全清理放进同一个 Tauri 桌面应用里，让用户不用学习命令、不用猜测原因，也能理解自己的电脑正在发生什么。

Qific Butler is a local AI desktop butler. It combines system monitoring, file discovery, AI diagnostics, and safe cleanup planning in one Tauri desktop application, so users can understand and maintain their computer without memorizing commands or guessing what went wrong.

## 项目定位 / Positioning

Qific Butler 不是一个只会显示数字的监控面板，也不是一个脱离本机上下文的聊天框。它的目标是让 AI 能够看见真实系统状态、理解本地文件元数据、解释风险边界，并在用户确认后完成低风险操作。

Qific Butler is not just a dashboard full of numbers, and it is not a context-free chatbot. The goal is to let AI observe real system state, reason over local file metadata, explain risk, and only act after the user confirms the plan.

The product loop is intentionally simple:

1. Observe the computer through local system data.
2. Explain what is happening with AI-assisted diagnostics.
3. Propose a safe plan instead of acting silently.
4. Ask for confirmation before cleanup or terminal actions.
5. Keep logs and move files to the trash instead of permanently deleting them.

## 当前能力 / Current Capabilities

### 实时系统监控 / Real-Time System Monitoring

- CPU, memory, disk, network, process, and available sensor data.
- Rolling resource trends and top process ranking.
- Graceful preview-mode fallback when the app is opened in the browser instead of Tauri.
- macOS-focused sensor support where platform APIs expose temperature, fan, or GPU data.

### AI 诊断助手 / AI Diagnostic Assistant

- OpenAI-compatible chat completions endpoint, API key, and model ID configuration.
- Conversation history stored locally.
- System-context-aware prompts for diagnosing slowness, high resource usage, cleanup needs, and process risk.
- Confirmable terminal diagnostics for low-risk inspection commands.

### 文件索引与发现 / File Indexing and Discovery

- Scans common user folders such as Downloads, Documents, Desktop, Pictures, and Videos.
- Reads metadata only: name, path, size, type, and modified time.
- Filters by file type, large files, recent changes, and archive candidates.
- Reveals local files in the system file manager when running inside Tauri.

### AI 辅助安全清理 / AI-Assisted Safe Cleanup

- Generates cleanup candidates from user intent.
- Groups files as large files, old files, or possible duplicates.
- Requires explicit user selection and confirmation before execution.
- Moves files to the trash instead of permanently deleting them.
- Stores a local cleanup log for recent actions.

### 设置 / Settings

- Local AI API configuration and connection testing.
- Dark and light theme switching.
- Experimental switches for future proactive alerts and incremental indexing.

## 产品原则 / Product Principles

- **本地优先 / Local-first**: file handling focuses on metadata, and user configuration is stored locally.
- **用户做主 / User control**: risky actions require confirmation; AI suggests before it acts.
- **有依据的答案 / Evidence-based answers**: diagnostics should be grounded in real system state.
- **可撤销优先 / Reversible by default**: cleanup moves files to the trash, not permanent deletion.
- **软件本身要轻 / The butler must stay light**: Tauri + Rust keeps system operations practical and efficient.

## Tech Stack

- React 19 + TypeScript
- Vite 7
- Tauri 2
- Rust backend
- `sysinfo`, `walkdir`, `trash`, `reqwest`, `tokio`

## Getting Started

Install dependencies:

```bash
npm install
```

Run the web preview:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

Check the project before publishing:

```bash
npm run check
```

## AI Configuration

The app accepts an OpenAI-compatible chat completions endpoint, API key, and model ID from the settings screen. These values are currently stored locally by the app.

Before distributing a production build, consider moving API key storage to the system keychain or another secure Tauri-side storage mechanism.

## Roadmap

- Stabilize the 0.1.0 core loop: monitoring, AI diagnostics, file metadata indexing, and safe cleanup.
- Add proactive anomaly alerts, startup item management, network traffic analysis, scheduled maintenance, and safer secret storage.
- Explore local model support, a plugin system, custom AI toolkits, and team/enterprise scenarios.

## Safety Notes

- Cleanup actions move files to the trash and require user confirmation.
- File analysis uses metadata such as path, name, size, and modified time.
- Terminal diagnostics are designed for low-risk inspection commands and require explicit confirmation.
- Review the Tauri content security policy before publishing a public release.

## Repository

This project is prepared for publication at [richyhu/Qific_Butler](https://github.com/richyhu/Qific_Butler).

Build artifacts, caches, local environment files, signing keys, and packaged archives are excluded through `.gitignore`. Do not commit personal API keys, signing certificates, or generated `src-tauri/target` output.

## License

Qific Butler is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE](LICENSE) for the full license text.
