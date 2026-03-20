## Context

EasyWork already has provider abstractions, but current wiring is partially static (single default provider registration and switch-based sandbox provider factory). This slows down integration of additional runtimes and increases coupling between core logic and provider-specific behavior.

## Goals / Non-Goals

**Goals:**
- Define a unified plugin registry contract for agent and sandbox runtimes.
- Migrate existing providers into plugin modules without changing external APIs.
- Support availability metadata, lifecycle hooks, and runtime switching through registries.
- Preserve existing behavior for current default providers.

**Non-Goals:**
- Introduce all future providers (`docker`, `e2b`, `codex`) in this change.
- Redesign user-facing settings UI.
- Change request/response shapes of current provider APIs.

## Decisions

### Decision 1: Shared registry pattern with typed plugin metadata
- **Choice:** Use a common registry model (register/get/list/availability/lifecycle) for both agent and sandbox plugin domains.
- **Rationale:** Reduces duplicate patterns and keeps operational semantics consistent.
- **Alternative considered:** Separate unrelated registry implementations. Rejected due to conceptual drift risk.

### Decision 2: Incremental migration with compatibility adapter layer
- **Choice:** Keep route and service interfaces stable while migrating internals to registries.
- **Rationale:** Prevents front-end regressions and allows phased rollout.
- **Alternative considered:** Big-bang replacement across all call sites. Rejected due to high regression risk.

### Decision 3: Capability-first plugin metadata
- **Choice:** Require plugins to expose capabilities (streaming/tool calling/isolation/fallback support) for runtime selection and diagnostics.
- **Rationale:** Enables policy-driven provider choice and clearer operational visibility.
- **Alternative considered:** Minimal metadata only. Rejected because capability-aware routing is a near-term need.

## Risks / Trade-offs

- [Risk] Migration layer increases temporary complexity.  
  → Mitigation: remove compatibility adapters after parity tests pass.
- [Risk] Subtle behavior regressions in provider initialization order.  
  → Mitigation: add initialization/switch/fallback parity tests and canary rollout.
- [Risk] Over-generalization of plugin interfaces may constrain specialized providers.  
  → Mitigation: keep optional extension points and plugin-specific config payloads.

## Migration Plan

1. Introduce registry primitives and plugin interfaces for agent and sandbox domains.
2. Port current providers (`claude` agent, `native/claude` sandbox) into plugin modules.
3. Update managers/services to use registry APIs for create/switch/availability.
4. Add compatibility tests to confirm route-level behavior remains unchanged.
5. Remove deprecated direct wiring paths after parity confirmation.

## Open Questions

- Should plugin discovery remain static registration or support file-system discovery in a follow-up?
- Do we need plugin version negotiation in registry APIs now or later?
