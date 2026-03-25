# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Language

Always respond to the user in Simplified Chinese.
Code, file content, commit messages, and tool outputs remain in their original language.

## Project Overview

**EasyWork** is a desktop AI assistant that executes tasks through natural language. Built with Tauri 2 (desktop) + React 19 (frontend) + Hono (backend API), powered by Claude Agent SDK.

## Feature Status

| Feature | Status | Description |
|---------|--------|-------------|
| Single Agent Execution | ✅ Production | `/api/agent/stream` - Main execution path |
| Multi-Agent Orchestration | 🚧 Experimental | Backend implemented (`/api/agent/multi/*`), frontend not integrated |
| MCP Support | ✅ Production | Model Context Protocol integration |
| Skills Support | ✅ Production | Custom agent skills |
| Sandbox Execution | ✅ Production | Native command execution |

> **Note:** Multi-agent code exists in `src-api/src/core/agent/orchestrator/` but is not connected to the frontend. Use single agent path for production features.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development (Web Mode)
pnpm dev:api          # Start API backend (port 2026)
pnpm dev:web          # Start frontend (port 1420)
pnpm dev:all          # Start both together
pnpm start            # Alias for dev:all

# Development (Desktop Mode)
pnpm dev              # Start Tauri development (auto-starts frontend + API sidecar)
pnpm start:tauri      # Alias for dev

# Build
pnpm build            # Build all packages
pnpm build:api        # Build API sidecar binary for current platform
pnpm build:api:all    # Build API sidecar for all platforms
pnpm build:desktop    # Full desktop build (build + sidecar + Tauri)

# Quality
pnpm typecheck        # Type checking
pnpm lint             # Lint
pnpm test             # Run tests (in src-api)

# Utility
./scripts/start.sh --clean      # Start with port cleanup
./scripts/start.sh --api-only   # Start API only
./scripts/start.sh --web-only   # Start web only
```

## Architecture

### Monorepo Structure (pnpm workspace)
```
src/           # Frontend React app
src-api/       # Backend API (Hono + Node.js)
src-tauri/     # Tauri desktop app (Rust)
shared-types/  # Shared TypeScript types
scripts/       # Build and start scripts
.claude/       # Claude Code skills (opsx/*)
openspec/      # OpenSpec change management
```

### Three-Layer Architecture
```
┌────────────────────────────────────────────┐
│  Frontend Layer                            │
│  React 19 + Vite + Tailwind CSS 4          │
│  - useAgent hook for agent communication   │
│  - isTauri() for web/desktop detection     │
└────────────────────────────────────────────┘
                    ↕ HTTP/SSE
┌────────────────────────────────────────────┐
│  API Service Layer (src-api)               │
│  Hono + Node.js + Claude Agent SDK         │
│  - AgentService: Core agent orchestration  │
│  - SandboxService: Native command execution│
│  - ToolRegistry: Tool management           │
│  - MCP & Skills integration                │
└────────────────────────────────────────────┘
                    ↕ IPC
┌────────────────────────────────────────────┐
│  Desktop Layer (src-tauri)                 │
│  Tauri 2 + Rust + SQLite                   │
│  - Window management, file system          │
│  - API sidecar bundled as binary           │
└────────────────────────────────────────────┘
```

### Key Data Flow
1. User input → `useAgent` hook (frontend)
2. POST `/api/agent/stream` → SSE streaming
3. AgentService → ClaudeAgent (Claude Agent SDK)
4. Tool execution via sandbox
5. Real-time SSE messages back to frontend
6. Persistence: SQLite (Tauri) or IndexedDB (web)

## Important Patterns

**Type Safety:** Strict TypeScript with centralized shared types in `shared-types/`

**Async Generators:** Used extensively for SSE streaming responses

**Registry Pattern:** `ToolRegistry` for tools, `AgentProviderRegistry` for LLM providers

**Service Layer:** `AgentService`, `SandboxService` encapsulate core business logic

**Interface-based Design:** `IAgent`, `ITool`, `IAgentProvider` interfaces in shared-types

## LLM Providers

Configure via `LLM_PROVIDER` env var: `claude`, `glm`, `openai`, `openrouter`, `kimi`

Required API keys: `ANTHROPIC_API_KEY`, `GLM_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `KIMI_API_KEY`

## API Endpoints

**Production Endpoints:**
- `/api/agent/stream` - SSE streaming agent responses (main execution path)
- `/api/agent/abort` - Abort execution
- `/api/sandbox/*` - Sandbox operations (execute, read, write, list)
- `/api/settings` - Settings management
- `/api/preview/*` - Preview server management
- `/api/providers/*` - LLM provider management

**Experimental Endpoints (not integrated with frontend):**
- `/api/agent/multi/stream` - Multi-agent execution
- `/api/agent/multi/preview` - Task decomposition preview
- `/api/agent/multi/status/:id` - Execution status

## Claude Code Skills

The `.claude/` directory contains OpenSpec workflow skills:
- `opsx:new` - Start a new change with artifact workflow
- `opsx:apply` - Implement tasks from an OpenSpec change
- `opsx:continue` - Continue working on a change
- `opsx:verify` - Verify implementation matches artifacts
- `opsx:archive` - Archive a completed change
- `opsx:sync` - Sync delta specs to main specs

## Frontend Routing Gotchas

**Component reuse across routes:** `/chat` and `/task/:taskId` both render `TaskDetailPage`. React Router reuses the same component instance when navigating between them, so `useRef` values persist across these navigations. Do NOT use `navigate()` for `/chat` → `/task/:id` transitions — use `window.history.replaceState()` instead to avoid triggering useEffect re-runs while preserving refs and running state.

**Task creation flow:** When creating a task from `/chat` (no taskId), `handleReply` creates the task in memory + DB, updates the URL via `replaceState`, then calls `run()` directly on the same component instance. The initialization useEffect should NOT re-trigger `run()` for this case.

**Message persistence:** `done` type messages must be persisted to DB — `deriveStatusFromMessages()` depends on them to detect task completion. Only `session` type messages should be skipped during persistence.

**Artifact IDs:** Use deterministic IDs based on file path (`artifact-${filePath}`) rather than message IDs, since message IDs change after DB restore (`db_${autoIncrementId}` vs original ID).
