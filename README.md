<div align="center">

# 🚀 Arclay

**A Desktop AI Assistant with Transparent Execution**

Transform natural language into reliable local automation through a controlled workflow

[![License](https://img.shields.io/github/license/WhiteSnoopy/Arclay)](https://github.com/WhiteSnoopy/Arclay/blob/main/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB?logo=tauri)](https://tauri.app)

[English](#) | [简体中文](./README.zh-CN.md)

<img src="./app-icon.png" alt="Arclay Logo" width="120">

</div>

---

## 🎯 What is Arclay?

Arclay is a **desktop-first AI assistant** that turns your plain-language requests into actionable results—files, reports, local services—through a **transparent, controllable workflow**.

Unlike black-box AI tools, Arclay shows you the plan before execution, giving you full control over what happens on your machine.

### ✨ Key Highlights

```
📝 Natural Language Input  →  🤖 AI Planning  →  ✅ Your Approval  →  ⚡ Safe Execution
```

- **🗣️ Speak Naturally** - Describe tasks in plain language, no technical jargon required
- **👀 Review First** - See the execution plan before anything runs
- **🔒 Local & Private** - Desktop app with local data storage, no cloud dependency
- **🛡️ Controlled Execution** - Runtime checks and sandbox boundaries protect your system
- **🔧 Extensible** - MCP and Skills support for advanced users (optional)

---

## 🚀 Quick Start

### 📋 Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | `>= 20` | Runtime for API service |
| **pnpm** | `>= 9` | Package manager |
| **Rust** | stable | Desktop app compilation |
| **Git** | latest | Version control |

### ⚡ Installation

```bash
# Clone the repository
git clone https://github.com/WhiteSnoopy/Arclay.git
cd Arclay

# Install dependencies
pnpm install
```

### 🎮 Run the App

**Desktop Mode** (Recommended - Production Stack)
```bash
pnpm dev
```

**Web Mode** (Development Only - Fast Iteration)
```bash
pnpm dev:all
```

### ⚙️ Configuration

Configure your LLM provider in the app's **Settings** page, or manually edit:

```bash
~/.arclay/settings.json
```

**Supported Providers:**

Arclay uses the **Claude Agent SDK**, which means any provider that supports the **Anthropic API format** can be integrated.

| Provider | API Key Required | Compatibility | Notes |
|----------|------------------|---------------|-------|
| Claude | `ANTHROPIC_API_KEY` | ✅ Native | Recommended, official support |
| OpenAI | `OPENAI_API_KEY` | ✅ Compatible | Via Anthropic-compatible wrapper |
| GLM | `GLM_API_KEY` | ✅ Compatible | Chinese market |
| Kimi | `KIMI_API_KEY` | ✅ Compatible | Chinese market |
| OpenRouter | `OPENROUTER_API_KEY` | ✅ Compatible | Multi-model gateway |

> **Note:** Any LLM provider that implements the Anthropic API format (Messages API, tool use, streaming) can be used with Arclay.

---

## 🏗️ Architecture Overview

Arclay is a **dual-process desktop application** built with modern web technologies:

```
┌─────────────────────────────────────────┐
│  Arclay Desktop App                     │
│                                         │
│  ┌─────────────┐      ┌──────────────┐ │
│  │   React UI  │ ←──→ │ Tauri Shell  │ │
│  │   (WebView) │      │   (Rust)     │ │
│  └──────┬──────┘      └──────────────┘ │
│         │ HTTP/SSE                      │
│  ┌──────▼──────────────────────────┐   │
│  │  API Sidecar (Node.js)          │   │
│  │  • Agent orchestration          │   │
│  │  • Tool execution               │   │
│  │  • MCP & Skills integration     │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 📦 Project Structure

```
apps/
├── web/              # React 19 + Vite frontend
├── agent-service/    # Hono + Node.js API sidecar
└── desktop/          # Tauri 2 + Rust desktop shell

packages/
└── shared-types/     # Shared TypeScript types
```

### 🔄 How It Works

**Three-Phase Workflow:**

1. **📝 Planning Phase**
   - AI analyzes your request
   - Generates a detailed `TaskPlan`
   - Classifies deliverable type (files, service, data, etc.)

2. **✅ Approval Phase**
   - You review the plan
   - Approve, reject, or request clarification
   - Full transparency before execution

3. **⚡ Execution Phase**
   - Controlled tool execution in sandbox
   - Real-time streaming feedback
   - Runtime verification and health checks

**Deliverable Types:**

| Type | Description | Runtime Verification |
|------|-------------|---------------------|
| `static_files` | HTML, CSS, documents | Relaxed |
| `local_service` | Dev servers, APIs | Strict health checks |
| `deployed_service` | Cloud deployments | Strict health checks |
| `script_execution` | One-off scripts | Relaxed |
| `data_output` | Reports, analysis | Relaxed |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [🇨🇳 中文文档](./README.zh-CN.md) | Chinese version of this README |
| [🏛️ Architecture](./ARCHITECTURE.md) | Detailed technical architecture |
| [🤝 Contributing](./CONTRIBUTING.md) | How to contribute to Arclay |
| [👨‍💻 Developer Guide](./AGENTS.md) | Step-by-step development workflows |
| [🤖 AI Collaboration](./CLAUDE.md) | Rules for AI-assisted development |

---

## 🛠️ Development

<details>
<summary><b>Click to expand development guide</b></summary>

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Desktop** | Tauri 2, Rust, SQLite |
| **Frontend** | React 19, Vite, Tailwind CSS 4, React Router 7 |
| **API** | Hono, Node.js, Claude Agent SDK, Zod |
| **Monorepo** | pnpm workspace |

### Development Workflow

```bash
# Frontend development (hot reload)
pnpm dev:all

# API development (standalone)
pnpm dev:api

# Desktop mode (production stack)
pnpm dev

# Run tests
pnpm test                # Unit tests
pnpm test:coverage       # Coverage report
pnpm test:e2e            # E2E tests

# Quality checks
pnpm typecheck           # TypeScript
pnpm lint                # ESLint

# Build
pnpm build               # All packages
pnpm build:desktop       # Desktop app
```

### Pre-Commit Checklist

Before submitting a PR, ensure:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes with ≥80% coverage
- [ ] `pnpm test:e2e` passes
- [ ] `pnpm build` succeeds
- [ ] Desktop mode tested manually

### Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev:web` | Start frontend only |
| `pnpm dev:api` | Start API only |
| `pnpm build:api` | Build API binary |
| `pnpm build:api:all` | Build for all platforms |
| `./scripts/start.sh --clean` | Clean ports and start |

</details>

---

## 🤝 Contributing

We welcome contributions! Please read our [Contributing Guide](./CONTRIBUTING.md) to get started.

**Quick Links:**
- [Report a Bug](https://github.com/WhiteSnoopy/Arclay/issues/new?labels=bug)
- [Request a Feature](https://github.com/WhiteSnoopy/Arclay/issues/new?labels=enhancement)
- [Ask a Question](https://github.com/WhiteSnoopy/Arclay/discussions)

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

---

<div align="center">

**Built with ❤️ using Tauri, React, and Claude Agent SDK**

[⭐ Star us on GitHub](https://github.com/WhiteSnoopy/Arclay) | [📖 Read the Docs](./ARCHITECTURE.md) | [💬 Join Discussions](https://github.com/WhiteSnoopy/Arclay/discussions)

</div>
