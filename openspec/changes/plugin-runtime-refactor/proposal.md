## Why

EasyWork currently wires provider and sandbox behavior with direct registration and switch-case branching, which makes extension and maintenance costly as new runtimes are added. A plugin runtime foundation is needed to decouple integration points and make new providers/sandboxes composable without touching core route logic.

## What Changes

- Introduce a plugin registry pattern for Agent providers in EasyWork.
- Introduce a plugin registry pattern for Sandbox providers with capability metadata.
- Migrate existing `claude` agent provider and `native/claude` sandbox providers into plugin implementations.
- Keep existing route contracts stable while switching internals to registry-driven dispatch.
- Add conformance tests for provider registration, availability checks, switching, and fallback behavior.

## Capabilities

### New Capabilities
- `plugin-runtime-architecture`: Extensible plugin runtime for agent and sandbox systems with stable API contracts.

### Modified Capabilities
- None.

## Impact

- Affected code: `src-api/src/core/agent/*`, `src-api/src/core/sandbox/*`, provider routes, manager services, tests.
- Affected architecture: moves from static wiring to registry-managed plugin model.
- Affected extensibility: future provider onboarding requires plugin modules rather than route/core rewrites.
