## 1. CI Workflow Foundation

- [x] 1.1 Create `.github/workflows/build.yml` with a four-platform matrix (linux/windows/macos-intel/macos-arm64)
- [x] 1.2 Add pinned toolchain/runtime setup (Node, pnpm, Rust) and cache strategy for each matrix job
- [x] 1.3 Add build metadata capture (version, commit SHA, build timestamp, target) to workflow outputs/logs

## 2. Packaging and Artifact Contract

- [x] 2.1 Standardize sidecar and desktop package naming across targets
- [x] 2.2 Generate SHA256 checksum files for every packaged artifact
- [x] 2.3 Upload artifacts and checksums from each matrix job for downstream release steps

## 3. Release Automation

- [x] 3.1 Add tag trigger (`vX.Y.Z`) to release workflow path
- [x] 3.2 Create/Update GitHub Release and attach all platform artifacts plus checksum files
- [x] 3.3 Add guard conditions so release publish executes only after all required jobs pass

## 4. Validation and Documentation

- [ ] 4.1 Verify workflow success on `workflow_dispatch` and `main` without release publish
- [ ] 4.2 Verify end-to-end tagged release creation with assets and checksums
- [x] 4.3 Document release runbook (build-only mode, publish mode, rollback and re-run steps)
