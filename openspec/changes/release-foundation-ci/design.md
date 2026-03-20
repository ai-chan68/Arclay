## Context

EasyWork has strong local development scripts but no repository-level release workflow in `.github/workflows/`. Cross-platform packaging exists in scripts and Tauri config, but orchestration, artifact conventions, and release publication are not standardized in CI.

## Goals / Non-Goals

**Goals:**
- Provide an end-to-end CI pipeline that builds desktop artifacts for four target platforms.
- Enforce deterministic artifact naming and checksum generation.
- Support tag-triggered release publication with attached assets.
- Improve traceability with build metadata (version/commit/time/target).

**Non-Goals:**
- Re-architect application runtime behavior.
- Introduce non-GitHub release platforms in this phase.
- Redesign application UI or user-facing feature workflows.

## Decisions

### Decision 1: GitHub Actions matrix as the single release orchestrator
- **Choice:** Use one primary matrix workflow with per-target jobs and shared quality gates.
- **Rationale:** Reduces duplicated logic and gives a single operational control plane.
- **Alternative considered:** Separate workflow per platform. Rejected due to drift and maintenance overhead.

### Decision 2: Explicit artifact naming contract
- **Choice:** Encode product, version, target triple, and package type in artifact names.
- **Rationale:** Enables deterministic automation for downstream distribution and verification.
- **Alternative considered:** Keep default tauri output names only. Rejected because naming differs across platforms and is harder to parse automatically.

### Decision 3: Tag-driven release with checksum bundle
- **Choice:** Publish only on semantic version tags (`vX.Y.Z`) and attach SHA256 checksums.
- **Rationale:** Creates auditable, reproducible release units.
- **Alternative considered:** Release on every merge to main. Rejected due to noise and weaker release discipline.

### Decision 4: Build metadata embedding
- **Choice:** Capture commit SHA, build time, and target in build outputs/logs.
- **Rationale:** Simplifies incident triage and rollback analysis.
- **Alternative considered:** Rely on GitHub UI metadata only. Rejected because metadata should travel with artifacts.

## Risks / Trade-offs

- [Risk] CI runtime and cost increase for multi-target builds.  
  → Mitigation: cache pnpm/rust layers, support manual target selection for ad-hoc runs.
- [Risk] Platform-specific dependency drift causes sporadic failures.  
  → Mitigation: pin toolchain versions and codify platform prerequisites in workflow.
- [Risk] Release job accidentally publishes incomplete assets.  
  → Mitigation: hard gate release on successful quality + package + checksum steps.

## Migration Plan

1. Add build matrix workflow in draft mode (`workflow_dispatch`) and validate artifact shape.
2. Enable main-branch build runs without publishing to harden reliability.
3. Enable tag-triggered release publish once two consecutive clean main runs are observed.
4. Document rollback: disable release job, keep build-only workflow active, republish from last known-good tag.

## Open Questions

- Should Windows signing/notarization be enforced in this phase or staged later?
- Should Homebrew cask update automation be included now or in a follow-up change?
