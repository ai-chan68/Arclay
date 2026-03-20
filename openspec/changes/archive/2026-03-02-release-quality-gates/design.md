## Context

EasyWork already supports API tests and type checks, but quality controls are uneven across workspace packages and not fully enforced before packaging and release. This allows quality regressions to slip into release workflows.

## Goals / Non-Goals

**Goals:**
- Make lint, typecheck, and tests mandatory release prerequisites.
- Ensure workspace commands call actual package scripts and fail fast when scripts are missing.
- Add smoke validation to catch basic desktop packaging/runtime regressions.
- Standardize quality gate logs for fast diagnosis.

**Non-Goals:**
- Introduce full end-to-end UI automation in this change.
- Replace current test framework or migrate all test suites.
- Redesign release orchestration outside of quality gate boundaries.

## Decisions

### Decision 1: Quality gates run as a dedicated CI stage
- **Choice:** Add a gate stage that must pass before any build/release stages.
- **Rationale:** Separates correctness checks from packaging and creates clear failure boundaries.
- **Alternative considered:** Inline checks inside each build job. Rejected due to duplicate execution and noisy diagnostics.

### Decision 2: Package-level script contract enforcement
- **Choice:** Require each workspace package to expose required quality scripts used by root commands.
- **Rationale:** Prevents root scripts from becoming no-op wrappers.
- **Alternative considered:** Keep root-level best-effort checks only. Rejected because it can mask missing checks.

### Decision 3: Smoke desktop check as minimum runtime guard
- **Choice:** Run `smoke:desktop` (or equivalent) after quality checks and before release publication.
- **Rationale:** Catches immediate packaging/runtime issues not covered by static checks.
- **Alternative considered:** Skip smoke checks in CI for speed. Rejected due to release risk.

## Risks / Trade-offs

- [Risk] CI time increases due to additional mandatory checks.  
  → Mitigation: optimize caching and keep smoke checks focused/minimal.
- [Risk] Initial pipeline failures from newly enforced gates.  
  → Mitigation: rollout with a short stabilization window and clear remediation logs.
- [Risk] Developers bypass local checks and depend on CI feedback loops.  
  → Mitigation: provide local `pre-release` command matching CI gates.

## Migration Plan

1. Add/align package-level scripts (`lint`, `typecheck`, `test`) for all workspace packages.
2. Add root pre-release command that mirrors CI quality gates.
3. Integrate quality gate job into CI and mark downstream jobs dependent on it.
4. Enable hard fail policy for release branches/tags after one stabilization cycle.

## Open Questions

- Should smoke checks run on all platforms or a selected subset for faster feedback?
- Should we require coverage thresholds in this phase or defer to a later change?
