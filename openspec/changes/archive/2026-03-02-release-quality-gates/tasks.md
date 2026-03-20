## 1. Workspace Quality Script Alignment

- [x] 1.1 Add or fix `lint` scripts for `src`, `src-api`, and `shared-types` packages
- [x] 1.2 Ensure root `lint`, `typecheck`, and `test` commands call actual package scripts and fail on missing scripts
- [x] 1.3 Add a root `pre-release` command that runs all mandatory quality checks in CI order

## 2. CI Gate Integration

- [x] 2.1 Add a dedicated `quality-gates` CI job executing lint, typecheck, and tests
- [x] 2.2 Add smoke desktop verification step and publish its logs as CI artifacts
- [x] 2.3 Make build/release jobs depend on successful completion of `quality-gates`

## 3. Failure Handling and Observability

- [x] 3.1 Standardize error messages for missing scripts and failing checks
- [x] 3.2 Ensure CI output clearly reports per-check pass/fail status
- [x] 3.3 Add troubleshooting notes for common gate failures

## 4. Verification

- [x] 4.1 Validate that intentional lint/type/test failures block release flow
- [x] 4.2 Validate that smoke failure blocks publication while preserving diagnostics
- [x] 4.3 Validate that successful gates allow downstream build and release jobs
