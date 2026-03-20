## Purpose

Define EasyWork's global appearance behavior so the product uses standard desktop theme modes (`Light`, `Dark`, `System`) instead of product-specific theme personas.

## Requirements

### Requirement: Standard Appearance Modes
The system SHALL expose three user-selectable appearance modes: `Light`, `Dark`, and `System`.

#### Scenario: Choosing a manual light theme
- **WHEN** the user selects `Light` in appearance settings
- **THEN** the application renders using the light appearance token set

#### Scenario: Choosing a manual dark theme
- **WHEN** the user selects `Dark` in appearance settings
- **THEN** the application renders using the dark appearance token set

#### Scenario: Choosing system-follow mode
- **WHEN** the user selects `System` in appearance settings
- **THEN** the application follows the operating system light/dark preference

### Requirement: Resolved Theme State
The system SHALL derive a resolved effective theme from the selected appearance mode.

#### Scenario: System preference changes while app is open
- **WHEN** the selected appearance mode is `System`
- **AND** the operating system preference changes between light and dark
- **THEN** the application updates its resolved theme accordingly without requiring the user to re-open settings

### Requirement: Appearance Settings Use Standard Semantics
The settings appearance surface SHALL present standard desktop appearance semantics instead of product-specific theme personas.

#### Scenario: Viewing the appearance settings tab
- **WHEN** the user opens the appearance tab
- **THEN** the available options are labeled `Light`, `Dark`, and `System`
- **AND** the interface does not present the legacy named theme personas as primary appearance options
