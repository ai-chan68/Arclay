# 🚀 Arclay

<p align="center">
  <img src="./app-icon.png" alt="Arclay Logo" width="100">
</p>

<p align="center">
  <a href="https://github.com/WhiteSnoopy/Arclay/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/WhiteSnoopy/Arclay" alt="License">
  </a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
</p>

> **Arclay** is a desktop AI assistant for ordinary users who want reliable local automation. It turns plain-language requests into files, reports, and task results through a controlled `Planning -> Approval -> Execution` workflow.

## Features

- **Ask in natural language**: describe what you want in plain words
- **Review before action**: see the plan before the app executes it
- **Desktop-first**: runs as a local desktop app with local data storage
- **Safer execution**: guarded command execution with runtime checks
- **Extensible when needed**: supports MCP and skills without exposing that complexity by default

## Quick Start

### Prerequisites

- Node.js `>= 20`
- pnpm `>= 9`
- Rust stable
- Git

### Install

```bash
git clone https://github.com/WhiteSnoopy/Arclay.git
cd Arclay
pnpm install
```

### Run

Desktop mode:

```bash
pnpm dev
```

Web development mode:

```bash
pnpm dev:all
```

Useful commands:

```bash
pnpm dev:web
pnpm dev:api
pnpm build
pnpm build:desktop
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm test:e2e
```

### Configure

Configure your provider and API key in the app Settings page, or edit:

```text
~/.arclay/settings.json
```

Supported providers:

- `claude`
- `glm`
- `openai`
- `openrouter`
- `kimi`

## Documentation

- [Getting Started](./docs/getting-started.md)
- [中文文档](./README.zh-CN.md)
- [Architecture](./ARCHITECTURE.md) - advanced technical overview

## Project Layout

```text
apps/
  web/            React frontend
  agent-service/  Node.js API sidecar
  desktop/        Tauri / Rust desktop shell
packages/
  shared-types/   shared frontend/backend types
```

## Core Ideas

### Guided execution

1. **Planning**: the model produces a `TaskPlan`
2. **Approval**: the user reviews the plan
3. **Execution**: the system executes with streaming feedback and runtime verification

### Different result types

Plans classify the expected output as one of:

- `static_files`
- `local_service`
- `deployed_service`
- `script_execution`
- `data_output`
- `unknown`

This helps Arclay decide whether it should verify a local service, produce static files, or return a one-time result.

### Runtime modes

- Desktop mode uses SQLite and the real production shell
- Web mode uses IndexedDB and is intended for iteration and E2E only

## Developer Notes

<details>
<summary>Expand for development and verification details</summary>

### Stack

- Desktop: Tauri 2 + Rust + SQLite
- UI: React 19 + Vite + Tailwind CSS 4 + React Router 7
- API: Hono + Node.js + Claude Agent SDK + Zod
- Monorepo: pnpm workspace

### Recommended workflow

- Frontend work: `pnpm dev:all`
- API work: `pnpm dev:api`
- Production-behavior verification: `pnpm dev`

### Pre-PR checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm build
```

### Read next

- Getting started: [docs/getting-started.md](./docs/getting-started.md)
- Detailed architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Contributor guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Developer operations: [AGENTS.md](./AGENTS.md)
- AI collaboration rules: [CLAUDE.md](./CLAUDE.md)

</details>

## License

[MIT License](./LICENSE)
