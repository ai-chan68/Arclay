# EasyWork

EasyWork is an open-source AI workbench built on the philosophy of **Harness Engineering**. It focuses on "real execution" rather than simple chat, transforming natural language tasks into automated workflows that can be planned, approved, executed, and recovered.

In EasyWork, we believe that **the Agent is the trained model, while the Harness (tools, observations, permissions, knowledge) is the code written by engineers**. This project is a complete practice of this philosophy.

Core Positioning:
- **Harness Driven**: Deeply integrated with the **Claude Agent SDK**, it's not just conversation but deep equipment and control of the local environment (files, commands, APIs).
- **Deterministic Execution Flow**: Follows the `Planning -> Approval -> Execution` paradigm, rejecting black-box operations.
- **Professional Developer Workbench**: Deeply integrated with Sandbox, MCP, and Skills router, targeting real output for local projects.

- [Chinese README](./README.md)

## Why This Project

Many AI products are good at answering questions but not good at stably completing tasks. EasyWork focuses on:

- How to give AI tasks clear stages and states.
- How to let users see the plan before execution and decide whether to continue.
- How to put tool calls, approvals, clarifications, files, and results into a unified workbench.
- How to make tasks reviewable, resumable, recoverable, and schedulable, rather than ending with a one-off chat.

If you are also working on Agents, desktop AI, task orchestration, approval flows, tool calling, or local workspace integration, EasyWork aims to be a runnable, referable, and extensible open-source foundation.

## Harness Engineering Philosophy

The core of EasyWork is the **Harness**. We provide the model with a professional, stable, and controlled work environment:

- **Granular Action Space**: Micro/Medium/Macro tools designed on demand, ensuring single responsibility and security control.
- **Structured Observation**: All tool responses follow a unified protocol (Success/Warning/Error), containing Root Cause and next action suggestions, ensuring the Agent can make autonomous decisions and recover.
- **Error Recovery Contract**: Follows the `root_cause_hint + safe_retry_instruction + stop_condition` contract to avoid tasks falling into silent failures or infinite loops.
- **Isolation and Parallelism**: Supports sub-Agent message isolation and Git Worktree-based task parallelism, ensuring environment cleanliness and security boundaries.

## Core Features

- **Two-phase Execution Flow**: Follows the `Planning -> Approval -> Execution` paradigm, supporting task decomposition preview and execution after approval.
- **Task Workbench**: Integrated Timeline, process tracing, result comparison, and real-time artifact preview.
- **Local Ecosystem**:
  - **Sandbox**: Native command execution sandbox, supporting explicit stdout/stderr separation and permission control. A clear **Error Contract** has been established for the Bash Tool, which can identify and autonomously handle exceptions such as "Timeouts" and "Missing Binaries," ensuring continuous execution.
  - **MCP Integration**: Deep support for Model Context Protocol, enabling dynamic injection of resources and tools.
  - **Skills Router**: Efficient task routing mechanism, optimizing Context Budgeting and enhancing long-task stability.
- **Runtime Observability**: Supports execution auditing, breakpoint resumption, and automated scheduling throughout the task lifecycle.

## Quick Start

### Requirements

- Node.js `>= 20`
- pnpm `>= 9`
- Git
- Rust stable (desktop mode only)
- Tauri prerequisites (desktop mode only): <https://v2.tauri.app/start/prerequisites/>

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
# Web joint debugging (recommended)
pnpm dev:all

# Start separately
pnpm dev:api
pnpm dev:web

# Desktop debug (Tauri)
pnpm dev
```

Default ports:

- API: `http://localhost:2026`
- Web: `http://localhost:1420`

### After First Run

1. Open the app and enter `/welcome`.
2. Configure at least one Provider in Settings.
3. Activate the Provider.
4. Enter a task and enter the `Plan -> Approval -> Execution` flow.
5. View the timeline, process, results, and artifacts on the task detail page.

Runtime settings and persistence data:

- Config: `~/.easywork/settings.json` (Model Providers, Sandbox preferences, etc.)
- Plans & Tasks: `~/.easywork/plans.json` & `~/.easywork/tasks.json`
- Approval Queue: `~/.easywork/approval-requests.json`
- Scheduled Records: `~/.easywork/scheduled-tasks.json`
- Runtime Context: `~/.easywork/turn-runtime.json` (Agent internal state persistence)

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
pnpm smoke:desktop:with-api
pnpm pre-release

# Build
pnpm build
pnpm build:api
pnpm build:desktop
```

## Project Structure

```text
src/            Frontend (React + Vite)
src-api/        Backend (Hono + Claude Agent SDK)
src-tauri/      Desktop shell (Tauri 2 + Rust)
shared-types/   Shared types across frontend and backend
scripts/        Build, quality gate, and release scripts
openspec/       OpenSpec specifications and change management
SKILLs/         Project-level Skill definitions
```

## License

- Project license: [`MIT`](./LICENSE)
- Third-party sources and attributions: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)