## Why

EasyWork currently lacks a repeatable multi-platform release pipeline in CI, so build and publish quality depends on manual local steps. This increases release risk, slows iteration, and makes cross-platform issues hard to detect early.

## What Changes

- Add a GitHub Actions build matrix for Linux, Windows, macOS Intel, and macOS Apple Silicon desktop packaging.
- Standardize API sidecar and desktop artifact naming across targets so outputs are deterministic and machine-consumable.
- Add tag-driven release automation with checksums and attached artifacts.
- Add a dedicated pre-release verification stage (typecheck, tests, smoke checks) as a required gate.
- Define release metadata conventions (version source, commit SHA, build timestamp) for traceability.

## Capabilities

### New Capabilities
- `release-foundation-ci`: Automated, traceable, and repeatable multi-platform build and release foundation for EasyWork desktop deliverables.

### Modified Capabilities
- None.

## Impact

- Affected code: `.github/workflows/*`, root `scripts/*`, `package.json`, `src-tauri/tauri.conf.json`, sidecar build scripts.
- Affected process: release flow moves from local/manual to CI/tag-driven automation.
- Affected systems: GitHub Actions runners, artifact storage, release assets.
