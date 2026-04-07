# Arclay Phase 2 Runtime Identity Rename Design

- **Date**: 2026-04-07
- **Topic**: Rename internal runtime and code identities from `arclay` to `arclay`
- **Status**: Design approved in conversation, pending written spec review

## 1. Background

Phase 1 completed the display-layer rename from `Arclay` to `Arclay`.

Phase 2 renames the actual runtime, package, and repository identities so that the product is not just branded as `Arclay`, but also operates and ships under the `arclay` name throughout the codebase and runtime environment.

This phase is explicitly a **breaking change**. The user accepted that:

- old `arclay` runtime identity does not need compatibility handling
- old local data and config do not need migration
- old environment variable names do not need dual support

## 2. Goals

- Rename runtime identity from `arclay` to `arclay`.
- Rename package scope from `@arclay/*` to `@arclay/*`.
- Rename sidecar, database, app identifier, config directory, environment variables, and storage keys to `arclay`.
- Align repository-facing examples and clone instructions with the new name.
- Keep the rollout coherent by applying changes in a `Runtime-first` sequence.

## 3. Non-Goals

This phase does not include compatibility fallbacks.

Specifically out of scope:

- automatic migration from `~/.arclay` to `~/.arclay`
- reading old `ARCLAY_*` variables
- dual support for `arclay-api` and `arclay-api`
- dual support for `@arclay/*` and `@arclay/*`
- preserving old localStorage / IndexedDB names
- preserving old clone paths, repo paths, or generated artifact names

This phase also does not attempt to preserve existing user data in place. Users adopting this version will effectively start on a fresh `arclay` identity.

## 4. Recommended Approach

Use a **Runtime-first hard cut**:

1. Rename desktop and sidecar runtime identity.
2. Rename local persistence and environment variable identity.
3. Rename package scope and imports.
4. Rename build, test, release, and repository-facing identity.

This approach is preferred because it keeps the work organized around real system boundaries instead of file types.

## 5. Runtime-first Change Layers

### 5.1 Runtime identity layer

Rename these core runtime identifiers:

- Tauri identifier: `com.arclay.app` -> `com.arclay.app`
- desktop package/crate names from `arclay` to `arclay`
- Rust library name from `arclay_lib` to `arclay_lib`
- sidecar name from `arclay-api` to `arclay-api`
- SQLite filename from `arclay.db` to `arclay.db`

Representative files:

- `apps/desktop/tauri.conf.json`
- `apps/desktop/Cargo.toml`
- `apps/desktop/src/main.rs`
- `apps/desktop/src/lib.rs`
- `apps/desktop/capabilities/default.json`
- generated capability/schema files if they are committed outputs

### 5.2 Local persistence and environment layer

Rename local storage identity:

- `~/.arclay` -> `~/.arclay`
- `ARCLAY_*` -> `ARCLAY_*`
- IndexedDB names using `arclay` -> `arclay`
- localStorage keys using `arclay` -> `arclay`
- test and temp directory prefixes using `arclay` -> `arclay`

Representative files:

- `apps/agent-service/src/shared/arclay-home.ts` or renamed equivalent
- `apps/agent-service/src/config.ts`
- `apps/agent-service/src/services/agent-service.ts`
- `apps/agent-service/src/settings-store.ts`
- `apps/web/shared/db/database.ts`
- `apps/web/shared/db/sqlite-adapter.ts`
- `apps/web/shared/config/app-config.ts`
- `apps/web/components/task-detail/SidebarContext.tsx`
- `apps/web/app/pages/TaskDetail.tsx`
- `apps/web/shared/theme/ui-theme.tsx`
- affected tests and fixtures

### 5.3 Package and import layer

Rename workspace package identity:

- `@arclay/web` -> `@arclay/web`
- `@arclay/agent-service` -> `@arclay/agent-service`
- `@arclay/shared-types` -> `@arclay/shared-types`

Also update:

- all import specifiers
- `pnpm --filter` usages
- references in scripts and configs

Representative files:

- root `package.json`
- `apps/web/package.json`
- `apps/agent-service/package.json`
- `packages/shared-types/package.json`
- all TS/TSX source files importing `@arclay/*`

### 5.4 Build, test, release, and repository layer

Rename outward-facing engineering identity:

- build artifacts from `arclay-*` to `arclay-*`
- release asset names from `arclay-*` to `arclay-*`
- repository URLs and clone instructions from `Arclay` to `Arclay`
- documentation paths and examples that still refer to `Arclay`

Representative files:

- `scripts/build-api-binary.sh`
- `scripts/prepare-release-assets.mjs`
- `scripts/start.sh`
- `scripts/smoke-desktop.mjs`
- `scripts/run-smoke-with-api.mjs`
- `e2e/*`
- `README.md`
- `README.zh-CN.md`
- `docs/getting-started.md`
- any GitHub templates or contribution docs

## 6. Must Change

These identities must be fully renamed in phase 2:

- `Arclay` product references that are still tied to repository identity
- `WhiteSnoopy/Arclay` repository references
- `cd Arclay` examples
- `com.arclay.app`
- `arclay-api`
- `arclay.db`
- `~/.arclay`
- `ARCLAY_*`
- `@arclay/*`
- `arclay` storage keys and IndexedDB names

## 7. Allowed Leftovers

The only acceptable leftover `Arclay` or `arclay` references after phase 2 should be:

- historical references inside prior design/spec documents when they are describing earlier system state
- unrelated examples in archived notes, if intentionally preserved

Any remaining active code or runtime reference to `arclay` should be treated as suspicious.

## 8. Risks

### Risk: startup failure

If sidecar names, Tauri capability allowlists, and shell sidecar lookup are not renamed together, desktop startup will fail.

### Risk: persistence breakage beyond intended scope

This phase intentionally breaks old identity compatibility, but accidental partial renames can create a worse state where neither old nor new identity works consistently.

### Risk: workspace/package breakage

If package names are changed without updating all imports and `pnpm --filter` references, typecheck and build will fail.

### Risk: test infrastructure breakage

If `ARCLAY_*` variables are renamed inconsistently in scripts and tests, E2E and integration harnesses will fail before product logic is exercised.

### Risk: repository drift

If repository URLs and clone commands are not updated after package/runtime rename, docs will describe a product identity that no longer matches the code.

## 9. Mitigations

- Execute in the defined `Runtime-first` order.
- Use targeted searches between each layer.
- Treat every remaining `arclay` token as a candidate bug until proven historical.
- Verify package-level typecheck after import/package renames.
- Verify build/test scripts after environment variable renames.

## 10. Verification Strategy

Minimum verification after each layer:

### After runtime identity layer

- Search confirms `com.arclay.app`, `arclay-api`, and `arclay.db` are present.
- Search confirms active runtime config no longer references `com.arclay.app`, `arclay-api`, or `arclay.db`.

### After persistence/environment layer

- Search confirms `~/.arclay` and `ARCLAY_*` are present.
- Search confirms active runtime code no longer reads `ARCLAY_*` or `~/.arclay`.

### After package/import layer

- `pnpm typecheck`
- Search confirms active imports no longer use `@arclay/*`.

### After build/test/repo layer

- `pnpm build`
- `pnpm test`
- targeted E2E or smoke verification for affected startup flow
- search confirms active docs no longer instruct cloning or entering `Arclay`

## 11. Success Criteria

Phase 2 is complete when:

- the active runtime identity is fully `arclay`
- the workspace package identity is fully `@arclay/*`
- build, test, and release scripts no longer depend on `arclay` names
- repository-facing documentation no longer presents `Arclay` as the current product/repo identity
- any remaining `arclay` references are explicitly historical rather than active
