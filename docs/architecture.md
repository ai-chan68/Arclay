# Architecture Notes

## Storage Ownership

- Desktop persistence uses the Rust-managed SQLite database under `src-tauri/src/db/`.
- Desktop schema changes are versioned through append-only Rust migrations.
- Browser persistence uses IndexedDB in `src/shared/db/database.ts`.
- IndexedDB versioning is browser-local and does not share the Rust `schema_version` contract.

## Tauri IPC Contract

### Naming Rule

- Rust commands keep `snake_case` names in `src-tauri/src/lib.rs`, such as `get_api_port`.
- TypeScript wrappers expose `camelCase` functions from `src/shared/tauri/commands.ts`, such as `getDesktopApiPort()`.

### Usage Rule

- App code must import desktop commands from `src/shared/tauri/commands.ts`.
- App code must not import `@tauri-apps/api/core` directly outside the wrapper module.
