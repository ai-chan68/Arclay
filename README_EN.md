# EasyWork

EasyWork is a desktop-first open-source AI workbench focused on real task execution rather than longer chat sessions.
It turns a natural-language request into a workflow that can be planned, approved, executed, resumed, and inspected.

[Chinese README](./README.md)

## What It Does

- Two-phase execution flow: `Planning -> Approval -> Execution`
- Clarification flow before planning when context is insufficient
- Intent-aware execution for web tasks: distinguishes information retrieval, interaction, and hybrid runs
- Strategy-driven execution: chooses between text extraction, browser automation, screenshots, and structured reads based on task intent
- Task workspace with turn timeline, process/result review, and artifact preview
- File previews for code, documents, images, spreadsheets, HTML, and more
- Pluggable Provider / Sandbox / Skills architecture
- Task persistence, approvals, interruption-aware recovery, and runtime replay
- Execution observability with provider completion metadata, browser action counters, and execution audit logs
- Appearance modes: `Light / Dark / System`

## Current Capabilities

| Feature | Status | Description |
|---------|--------|-------------|
| Two-phase execution | ✅ Available | `/api/v2/agent/plan` -> `/api/v2/agent/execute` |
| Direct answers for simple queries | ✅ Available | Planning may return `direct_answer` |
| Legacy API sunset | ✅ Done | `/api/agent/*` returns migration hints |
| MCP support | ✅ Available | Configurable MCP servers injected at runtime |
| Skills support | ✅ Available | Project-level skills defined under `SKILLs/` |
| Intent-aware web execution | ✅ Available | Web runs can adapt execution strategy by task intent |
| Interrupted execution semantics | ✅ Available | `max_turns` with meaningful progress is treated as interrupted instead of failed |
| Runtime observability | ✅ Available | Provider completion metadata and browser action summaries are recorded |
| File preview | ✅ Available | Preview panel supports PDF/PPT/docs/code/images |
| Task detail workspace | ✅ Available | Timeline + process/result + preview layout |
| Appearance modes | ✅ Available | `Light / Dark / System` in Settings |
| Multi-agent orchestration | 🚧 Experimental | Backend exists, frontend integration is incomplete |

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
cd easeWork

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
