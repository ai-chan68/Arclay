## Purpose

Define mandatory release quality gates for EasyWork so build and release stages only run after verified lint, typecheck, test, and smoke checks.

## Requirements

### Requirement: Mandatory Quality Gate Stage
The release process SHALL include a mandatory quality gate stage that executes before build and release jobs, and downstream stages MUST NOT run when the gate fails.

#### Scenario: Quality gate failure blocks release
- **WHEN** any required quality check fails
- **THEN** the quality gate stage is marked failed
- **AND** build/release stages are skipped or blocked

### Requirement: Workspace Script Contract Integrity
Workspace-level quality commands SHALL execute real package-level scripts, and SHALL fail when required scripts are missing in any targeted package.

#### Scenario: Missing package lint script
- **WHEN** root quality command targets a package without the required `lint` script
- **THEN** command execution fails with an explicit missing-script error
- **AND** CI quality gate is marked failed

### Requirement: Pre-Release Smoke Validation
The release process SHALL run a desktop smoke validation step after static checks and before artifact publication.

#### Scenario: Smoke validation detects runtime packaging issue
- **WHEN** the smoke step cannot complete expected startup/verification checks
- **THEN** the release workflow fails before publication
- **AND** no release artifacts are published

### Requirement: Quality Gate Traceability
Quality gate outputs SHALL include per-check status and failure reasons that are accessible from CI logs.

#### Scenario: Debugging failed release eligibility
- **WHEN** a quality gate fails
- **THEN** operators can identify which check failed (`lint`, `typecheck`, `test`, or smoke)
- **AND** access failure logs without rerunning unrelated jobs
