# 🚀 EasyWork

<p align="center">
  <img src="./docs/assets/banner.png" alt="EasyWork Banner" width="800">
</p>

<p align="center">
  <a href="https://github.com/workany-ai/workany/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/workany-ai/workany" alt="License">
  </a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
</p>

> **EasyWork** is a professional AI developer workbench built on the philosophy of **Harness Engineering**. It transforms natural language into stable, controllable local development output through a deterministic `Planning -> Approval -> Execution` workflow.

---

### 📺 Showcases

| Scenario | Preview |
| :--- | :--- |
| **Automated Code Refactoring** | ![Refactor Demo](./docs/assets/refactor-demo.gif) |
| **Environment Setup** | ![Setup Demo](./docs/assets/setup-demo.gif) |

### ✨ Key Features

- 🛠️ **Harness-Driven**: Agent is the model, Harness (tools, observations, permissions) is the code written by engineers.
- 🔒 **Native Sandbox**: Secure local command execution with robust error recovery contracts.
- 🏗️ **Deterministic Execution**: Rejecting black-box AI behavior, following the `Planning -> Approval -> Execution` paradigm.
- 🧩 **Dynamic Extensibility**: Deep integration with MCP (Model Context Protocol) and Skills router.

### 🏗️ Architecture

<p align="center">
  <img src="./docs/assets/architecture-diagram.png" alt="Architecture" width="600">
</p>

EasyWork uses a three-layer architecture for cross-platform stability and performance:
- **Frontend**: React 19 + Vite + Tailwind CSS 4
- **API Service**: Hono + Node.js + Claude Agent SDK
- **Desktop Layer**: Tauri 2 + Rust + SQLite

### ⚡ Quick Start

#### Prerequisites
- Node.js >= 20, pnpm >= 9, Git, Rust (Stable)

#### Installation
```bash
# Clone the repository
git clone <repo-url> && cd EasyWork

# Install dependencies and start
pnpm install && pnpm dev:all
```

| Command | Description |
| :--- | :--- |
| `pnpm dev:all` | Start in Web debug mode (API + Frontend) |
| `pnpm build` | Build the entire project |
| `pnpm test` | Run backend automated tests |

### ⚙️ Configuration

Edit `~/.easywork/settings.json` or configure environment variables like `ANTHROPIC_API_KEY` in the UI.

### 🤝 Contribution & License

- [MIT License](./LICENSE)
- [Chinese README](./README.md)
