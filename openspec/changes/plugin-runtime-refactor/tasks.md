## 1. Registry Foundation

- [x] 1.1 Define shared plugin metadata and lifecycle interfaces for agent and sandbox runtimes
- [x] 1.2 Implement agent plugin registry with register/get/list/availability/create semantics
- [x] 1.3 Implement sandbox plugin registry with capability metadata and fallback-aware provider selection

## 2. Provider Migration

- [x] 2.1 Migrate current `claude` agent provider into plugin module registration flow
- [x] 2.2 Migrate current `native` and `claude` sandbox providers into plugin module registration flow
- [x] 2.3 Remove or isolate direct switch-case provider construction paths behind compatibility adapters

## 3. Service and Route Integration

- [x] 3.1 Update provider manager and agent service to resolve providers through registry APIs
- [x] 3.2 Update sandbox service and related routes to resolve providers through registry APIs
- [x] 3.3 Verify existing provider/sandbox endpoints remain contract-compatible

## 4. Conformance and Regression Testing

- [x] 4.1 Add tests for plugin registration, initialization, and availability reporting
- [x] 4.2 Add tests for provider switching and fallback behavior
- [x] 4.3 Add regression tests confirming no route-level contract changes during migration
