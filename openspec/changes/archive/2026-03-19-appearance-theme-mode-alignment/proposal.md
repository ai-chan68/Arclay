## Why

EasyWork currently exposes four product-specific visual themes (`operator`, `tech`, `worker`, `sharp`). That model makes the appearance system feel brand-internal rather than familiar, and it diverges from the expectation users bring from desktop tools like Codex app, where appearance is primarily controlled through `Light`, `Dark`, and `System`.

The current setup also spreads visual semantics across both theme identity and color mode. As the UI matures, EasyWork benefits more from a simpler appearance contract that matches operating-system expectations and makes future visual polish easier to reason about.

## What Changes

- Replace the current four-option appearance mode selector with `Light`, `Dark`, and `System`.
- Update the UI theme context so the application resolves to light or dark appearance based on explicit user selection or system preference.
- Retune shared UI tokens so EasyWork's surfaces, borders, shadows, and settings panels align with the new light/dark model.
- Keep the existing EasyWork visual language, but express it through light/dark variants instead of named brand themes.

## Capabilities

### New Capabilities
- `appearance-theme-modes`: A global appearance system that supports `Light`, `Dark`, and `System` modes for the EasyWork desktop UI.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/shared/theme/ui-theme.tsx`, `src/components/task-detail/SettingsModal.tsx`, `src/index.css`, and related appearance-driven UI surfaces.
- Affected UX: the settings page changes from named style presets to standard appearance modes.
- Affected state flow: theme persistence and application bootstrap must resolve `system` preference into effective light/dark rendering.
