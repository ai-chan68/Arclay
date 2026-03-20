# Repository Guidelines

## Project Structure & Module Organization
This repo is a pnpm workspace with three main packages:

- `src/`: React + Vite frontend (task UI, routing, SSE consumption).
- `src-api/`: Hono + TypeScript backend (agent plan/execute routes, services, schedulers).
- `shared-types/`: shared TypeScript types consumed by frontend and backend.

Supporting directories:

- `src-tauri/`: desktop shell and sidecar integration.
- `scripts/`: build, quality-gate, smoke, and release scripts.
- `docs/` and `openspec/`: RFCs and specification/change docs.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies (Node >= 20, pnpm >= 9).
- `pnpm dev:all`: run API + Web locally (`2026` + `1420`).
- `pnpm dev:api` / `pnpm dev:web`: run one service only.
- `pnpm build`: build all workspace packages.
- `pnpm test`: run workspace test gate (currently meaningful tests are in `src-api` via Vitest).
- `pnpm lint` and `pnpm typecheck`: type-based lint/type gates across packages.
- `pnpm pre-release`: run full local quality sequence used before release.

## Coding Style & Naming Conventions
- Language: TypeScript ESM across packages.
- Follow existing file-local style (most TS files use 2-space indent and omit semicolons).
- Naming:
  - React components/types: `PascalCase` (e.g., `TaskDetail.tsx`).
  - functions/variables: `camelCase`.
  - tests: `*.test.ts`.
- Use path aliases where configured: `@` and `@shared-types`.

## Testing Guidelines
- Framework: Vitest in `src-api` (`src-api/vitest.config.ts`).
- Test placement: colocate in `src-api/src/**/__tests__/` or `src-api/src/**/*.test.ts`.
- Focus coverage on route behavior, store state transitions, and service edge cases (e.g., conflict/timeout/recovery paths).
- Run `pnpm --filter src-api test` for backend-only iteration.

## Commit & Pull Request Guidelines
- Current history uses concise prefix style, commonly `change:<summary>` (often Chinese summaries).
- Keep commits scoped and atomic; use imperative, specific summaries.
- PRs should include:
  - what changed and why,
  - impacted modules/APIs,
  - test evidence (commands run, key outputs),
  - screenshots/GIFs for `src/` UI changes.
- Before opening PR, ensure `pnpm lint && pnpm typecheck && pnpm test` passes locally.

## Security & Configuration Tips
- Do not commit secrets; runtime config is user-local under `~/.easywork/`.
- Treat `~/.easywork/*.json` as local runtime state, not repository artifacts.
