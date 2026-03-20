## ADDED Requirements

### Requirement: Agent Plugin Registry
The system SHALL provide an agent plugin registry that supports plugin registration, metadata discovery, availability checks, and runtime instance creation by provider type.

#### Scenario: Creating an agent instance via registry
- **WHEN** a valid registered provider type is requested
- **THEN** the registry returns an initialized agent instance for that type
- **AND** provider metadata is available for API inspection

### Requirement: Sandbox Plugin Registry
The system SHALL provide a sandbox plugin registry that supports plugin registration, capability metadata exposure, availability checks, and provider selection with fallback support.

#### Scenario: Fallback when preferred sandbox provider is unavailable
- **WHEN** a request selects a sandbox provider that is unavailable
- **THEN** the runtime selects a configured fallback provider
- **AND** reports the fallback decision in execution metadata

### Requirement: API Contract Compatibility During Migration
The system SHALL preserve existing provider and sandbox route contracts while internal runtime wiring is migrated to plugin registries.

#### Scenario: Existing provider API continues to work
- **WHEN** clients call current provider management endpoints
- **THEN** responses maintain existing status and payload contract
- **AND** internal registry-based dispatch is transparent to clients

### Requirement: Plugin Conformance Verification
The system SHALL include conformance checks validating plugin lifecycle behavior (register, initialize, switch, shutdown) for migrated providers.

#### Scenario: Switching active provider
- **WHEN** the active provider is switched via management API
- **THEN** the previous provider instance is safely shut down
- **AND** the target provider initializes and becomes active without service interruption
