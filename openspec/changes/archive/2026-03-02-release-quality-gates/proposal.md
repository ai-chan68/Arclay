## Why

EasyWork has typecheck and test commands, but lint execution at workspace level is not currently enforceable end-to-end, which creates a false sense of release readiness. A release-quality gate is needed so broken quality checks cannot pass into build and publish stages.

## What Changes

- Define a mandatory quality gate stage for release pipelines.
- Ensure workspace-level `lint`, `typecheck`, and `test` run real package scripts and fail on missing or failing checks.
- Add desktop smoke verification as a pre-release guard.
- Enforce release blocking behavior: package/release jobs run only if all quality gates pass.
- Standardize quality check outputs for troubleshooting and auditing.

## Capabilities

### New Capabilities
- `release-quality-gates`: Enforced pre-release quality gate framework for EasyWork build and release pipelines.

### Modified Capabilities
- None.

## Impact

- Affected code: root and package-level `package.json`, quality scripts under `scripts/`, CI workflows.
- Affected process: release eligibility now depends on explicit quality gate success.
- Affected teams: developers must keep package-level lint/test contracts valid.
