# Agent Runtime Factory Design

## Goal

Introduce a small runtime factory in `src-api` so startup wiring is separated from route consumption, and `routes/agent-new.ts` no longer depends on module-level `set/getAgentService()` state.

## Scope

This design covers the first factory-pattern slice only:

- add an `AppRuntime`-style factory for API startup wiring
- move `agent-new` routes to explicit dependency injection
- keep the existing store singletons (`approvalCoordinator`, `planStore`, `turnRuntimeStore`) unchanged for now
- keep provider initialization and sandbox startup behavior equivalent to today

This design does not cover:

- a full application container for every service
- daemon process extraction
- provider registry redesign
- moving every route away from module-level state in one pass

## Current Problem

`src-api/src/index.ts` currently does three jobs at once:

- reads runtime configuration
- constructs `AgentService` and sandbox services
- mutates route state through `setAgentService()` and similar setters

`src-api/src/routes/agent-new.ts` then consumes this wiring through module-level mutable variables:

- `let agentService: AgentService | null = null`
- `let agentServiceConfig: AgentServiceConfig | null = null`
- `setAgentService()`
- `getAgentService()`

This creates three concrete problems:

1. Route behavior depends on initialization order rather than explicit inputs.
2. Tests cannot construct route instances with isolated dependencies.
3. The current shape blocks later work on provider/runtime factories because route modules are also acting as service registries.

## Recommended Approach

Use a small runtime container focused on startup wiring, not a full framework-style application context.

The new boundary is:

- `src-api/src/index.ts` owns startup
- `src-api/src/runtime/app-runtime.ts` owns construction
- `src-api/src/routes/agent-new.ts` exports a route factory that receives its dependencies explicitly

This keeps the first refactor small while removing the most problematic global agent-service state.

## Design

### 1. Add an API Runtime Factory

Create a new file:

- `src-api/src/runtime/app-runtime.ts`

Responsibilities:

- resolve current provider/settings-derived `AgentServiceConfig`
- create the `AgentService` when provider credentials are available
- initialize sandbox services
- expose a small runtime object used by API startup

Proposed shape:

```ts
export interface AgentRuntimeState {
  agentService: AgentService | null
  agentServiceConfig: AgentServiceConfig | null
}

export interface AppRuntime {
  readonly workDir: string
  getAgentRuntimeState(): AgentRuntimeState
  initializeSandboxServices(): Promise<void>
}

export async function createAppRuntime(): Promise<AppRuntime> {
  // startup wiring only
}
```

The runtime object should stay small. It is a composition boundary, not a general service locator.

### 2. Replace Route-Level Mutable Agent State

`src-api/src/routes/agent-new.ts` should stop storing mutable module state for the agent runtime.

Replace:

- `setAgentService()`
- `clearAgentService()`
- `getAgentService()`
- module-scoped `agentService` / `agentServiceConfig`

With:

```ts
export interface AgentRouteDeps {
  getAgentRuntimeState: () => {
    agentService: AgentService | null
    agentServiceConfig: AgentServiceConfig | null
  }
}

export function createAgentNewRoutes(deps: AgentRouteDeps): Hono {
  const routes = new Hono()
  // handlers read deps.getAgentRuntimeState()
  return routes
}
```

Handlers should read runtime state at request time so later provider/settings refresh work can update the runtime without rebuilding route modules.

### 3. Keep Existing Store Singletons for This Slice

The following existing modules stay as-is in this iteration:

- `approvalCoordinator`
- `planStore`
- `turnRuntimeStore`
- `agentRunStore`
- scheduler-related singletons

Reason:

- they are not the main coupling problem yet
- changing them in the same slice would turn a focused boundary refactor into a broad architecture rewrite

This slice is successful if agent runtime construction becomes explicit, even while other stores remain module-level.

### 4. Update API Startup to Use the Runtime

`src-api/src/index.ts` should:

- create the runtime once during startup
- pass route dependencies when building the route tree
- stop importing `setAgentService()` from `routes/agent-new`

Desired startup flow:

1. initialize providers
2. create runtime
3. initialize sandbox services through runtime
4. create routes with injected runtime accessors
5. register routes on Hono

### 5. Route Composition Change

`src-api/src/routes/index.ts` will likely need to become a route factory too, so it can receive the dependencies needed by `agent-new`.

Recommended shape:

```ts
export interface RouteFactoriesDeps {
  agentNew: AgentRouteDeps
}

export function createRoutes(deps: RouteFactoriesDeps): Hono {
  const routes = new Hono()
  routes.route('/agent', createAgentNewRoutes(deps.agentNew))
  return routes
}
```

Only pass the dependencies actually required by child routes.

## File Changes

Create:

- `src-api/src/runtime/app-runtime.ts`

Modify:

- `src-api/src/index.ts`
- `src-api/src/routes/index.ts`
- `src-api/src/routes/agent-new.ts`
- related tests around startup wiring and agent route readiness

## Testing Strategy

Add or update tests at three levels.

### Runtime Factory Tests

Verify:

- runtime returns `agentService: null` when no provider is configured
- runtime builds `agentService` when active provider config is valid
- sandbox initialization still runs exactly once

### Route Injection Tests

Verify:

- `agent-new` routes return the existing structured unavailable body when injected runtime has no agent service
- `agent-new` routes execute normally when injected runtime returns a valid agent service/config pair

### Startup Composition Tests

Verify:

- API startup composes routes without calling route-level setter APIs
- route tree is built from explicit factory functions

## Migration Notes

This is an internal refactor. No external API changes are intended.

Behavior that must remain stable:

- same provider resolution priority
- same sandbox initialization semantics
- same `/api/agent/*` HTTP contract
- same structured error body when agent service is unavailable

## Risks

### Risk: Refactor expands into a full container rewrite

Mitigation:

- keep `AppRuntime` minimal
- inject only `getAgentRuntimeState` into `agent-new`
- leave unrelated singletons untouched

### Risk: Route composition changes break startup

Mitigation:

- keep `createRoutes()` behavior equivalent to current route registration
- add composition tests around startup wiring

### Risk: Hidden consumers still depend on `getAgentService()`

Mitigation:

- search for all `getAgentService()` and `setAgentService()` references and update them in the same slice
- fail the refactor if route code still requires hidden mutable state

## Success Criteria

This slice is complete when:

- `routes/agent-new.ts` has no module-level mutable agent-service state
- API startup uses a runtime factory instead of mutating route-local globals
- tests cover both configured and unconfigured runtime cases
- existing `pnpm test` and `pnpm typecheck` remain green
