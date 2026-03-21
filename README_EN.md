# EasyWork

EasyWork is a desktop-first open-source AI workbench focused on real task execution rather than longer chat sessions.
It turns a natural-language request into a workflow that can be planned, approved, executed, resumed, and inspected.

[Chinese README](./README.md)

## What It Does

- Two-phase execution: `Planning -> Approval -> Execution`, with clarification before planning when needed
- Intent-aware execution: distinguishes information retrieval, interaction, and hybrid web tasks, then adapts execution strategy
- Unified task workspace: turn timeline, process/result review, and artifact preview
- Extensible runtime: supports `Provider / Sandbox / MCP / Skills`
- Recovery and observability: approval callbacks, waiting-for-user pauses, interruption-aware recovery, history replay, and execution audit logs
- Scheduling and desktop experience: recurring tasks plus `Light / Dark / System` appearance modes

## Quick Start

### Requirements

- Node.js `>= 20`
- pnpm `>= 9`
- Git
- Rust stable for desktop mode
- Tauri prerequisites for desktop mode: <https://v2.tauri.app/start/prerequisites/>

### Install

```bash
git clone <your-repo-url>
cd EasyWork

corepack enable
corepack prepare pnpm@9 --activate
pnpm install
```

### Run

```bash
# API + Web
pnpm dev:all

# API only
pnpm dev:api

# Web only
pnpm dev:web

# Desktop app (Tauri)
pnpm dev
```

Default ports:

- API: `http://localhost:2026`
- Web: `http://localhost:1420`

On first run, configure at least one model provider in Settings and activate it.

Runtime settings are stored locally on your machine:

- `~/.easywork/settings.json`
- `~/.easywork/plans.json`
- `~/.easywork/approval-requests.json`
- `~/.easywork/scheduled-tasks.json`
- `~/.easywork/turn-runtime.json`

## Common Commands

```bash
# Development
pnpm dev:all
pnpm dev:api
pnpm dev:web
pnpm dev

# Quality
pnpm lint
pnpm typecheck
pnpm test
pnpm pre-release

# Build
pnpm build
pnpm build:api
pnpm build:desktop
```

## Project Structure

```text
src/           Frontend (React + Vite)
src-api/       Backend (Hono + Agent Runtime)
src-tauri/     Desktop shell (Tauri 2 + Rust)
shared-types/  Shared TypeScript types
scripts/       Build, release, and quality scripts
openspec/      Specs and change workflow
SKILLs/        Project-level skills
```

## License

- Project license: [`MIT`](./LICENSE)
- Third-party sources and attributions: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
