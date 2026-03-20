## ADDED Requirements

### Requirement: Multi-Platform CI Build Matrix
The release foundation SHALL provide an automated CI build matrix that packages EasyWork desktop artifacts for Linux, Windows, macOS Intel, and macOS Apple Silicon.

#### Scenario: Matrix build on main branch
- **WHEN** a commit is pushed to `main`
- **THEN** CI starts build jobs for all configured target platforms
- **AND** each job produces platform-specific package artifacts

### Requirement: Deterministic Artifact and Checksum Outputs
The release foundation SHALL generate deterministic artifact names and publish SHA256 checksums for every packaged release asset.

#### Scenario: Build output naming and checksum generation
- **WHEN** a packaging job succeeds
- **THEN** output artifacts follow the documented naming convention including product, version, and target
- **AND** a checksum file is generated for each artifact

### Requirement: Tag-Driven Release Publication
The release foundation SHALL publish release assets only for semantic version tags and SHALL attach all built artifacts and checksums to the corresponding release.

#### Scenario: Publishing a tagged release
- **WHEN** a tag matching `vX.Y.Z` is pushed
- **THEN** the release workflow creates or updates a release entry for that tag
- **AND** uploads artifacts and checksum files from successful platform jobs

### Requirement: Build Traceability Metadata
The release foundation SHALL record release build metadata including version, commit SHA, build timestamp, and target platform in CI logs or packaged metadata outputs.

#### Scenario: Metadata availability during incident triage
- **WHEN** operators inspect a built artifact or CI run
- **THEN** they can identify the commit SHA and build time associated with the artifact
- **AND** map it to the target platform without manual inference
