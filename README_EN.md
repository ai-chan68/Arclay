# EasyWork

EasyWork is a desktop AI work assistant powered by Claude Agent SDK. It supports natural-language task planning, approval, and execution.

[Technical Design (ZH)](./EasyWork技术方案.md) | [Chinese README](./README.md)

## Current Capabilities

| Feature | Status | Description |
|---------|--------|-------------|
| Two-phase execution (primary path) | ✅ Available | `/api/v2/agent/plan` -> `/api/v2/agent/execute` |
| Direct answers for simple queries | ✅ Available | Planning phase may return `direct_answer` (no approval needed) |
| Legacy API sunset (smooth migration) | ✅ Done | `/api/agent/*` now returns `410` with migration hints; primary flow is `/api/v2/agent/*` |
| MCP support | ✅ Available | Configurable MCP servers injected during execution |
| Skills support | ✅ Available | Project `SKILLs/` synced to `.claude/skills/` |
| File preview | ✅ Available | Right panel supports PDF/PPT/docs/code/images |
| Task detail workspace | ✅ Available | Left turn timeline + center process/result + right preview |
| Appearance modes | ✅ Available | `Light / Dark / System` in Settings |
| Brand icon system | ✅ Updated | Platform icons generated from `app-icon.svg` |
| Multi-agent orchestration | 🚧 Experimental | Backend exists, frontend not integrated |

## Interaction Model

- Default flow is two-phase: plan first, then execute after user approval.
- Simple prompts can be answered directly in planning phase.
- Image attachments skip planning and go to direct execution (`/api/v2/agent`).
- Follow-up prompts in the same task are re-evaluated via `runAgent` (planning included), not auto-forced into direct execution.
- Appearance can be switched in `Settings -> Appearance` (`Light / Dark / System`).
- Task detail uses a workspace layout with timeline navigation, detailed process/result review, and synchronized artifact preview.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start API + Web
pnpm dev:all

# Start desktop app (Tauri)
pnpm dev
```

On first run, configure your model provider and API key in Settings.
You can also switch appearance instantly in `Settings -> Appearance`.

## Common Commands

```bash
# API / Web
pnpm dev:api
pnpm dev:web

# Quality
pnpm typecheck
pnpm lint
pnpm test

# Build
pnpm build
pnpm build:desktop

# Regenerate app icons (all Tauri platforms)
pnpm tauri icon app-icon.svg
```

## Built-in Skills

| Skill | Purpose |
|-------|---------|
| `baoyu-slide-deck` | Slide deck generation |
| `canvas-design` | Visual design generation |
| `deep-research` | Research-style reporting |
| `frontend-slides-main` | HTML presentation generation |
| `planning-with-files` | File-aware planning assistance |
| `web-search` | Search-oriented task support |

## Project Structure

```text
src/           Frontend (React + Vite)
src-api/       Backend (Hono + Claude Agent SDK)
src-tauri/     Desktop shell (Tauri + Rust)
shared-types/  Shared TypeScript types
SKILLs/        Project-level skills
app-icon.svg   Icon source used to generate Tauri multi-platform icons
```

## License

- Project license: [`MIT`](./LICENSE)
- Third-party sources and attributions: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
