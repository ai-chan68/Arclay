## Context

EasyWork's current appearance system treats themes as product personas. That worked while the product was exploring style directions, but it now introduces unnecessary decision load: users are not choosing between fundamentally different work modes, they are choosing how bright or dark the interface should be.

The product direction is to align the appearance model with Codex-style desktop expectations:

- `Light` for explicit bright mode
- `Dark` for explicit dark mode
- `System` for OS-following behavior

This is a UX simplification and a state-model simplification at the same time.

## Goals / Non-Goals

**Goals:**
- Replace named persona themes with `Light`, `Dark`, and `System`.
- Persist the user's selected theme mode and derive a resolved effective theme at runtime.
- Keep EasyWork's surfaces and cards visually coherent in both light and dark modes.
- Make the appearance settings copy, controls, and semantics feel familiar to desktop users.

**Non-Goals:**
- Rebuild every screen's component styling from scratch.
- Introduce per-page custom theme overrides.
- Add user-editable theme token controls.
- Preserve the old four-theme selector as a visible fallback.

## Decisions

### Decision 1: Model theme as mode selection, not brand selection
- **Choice:** The public setting exposes only `Light`, `Dark`, and `System`.
- **Rationale:** This matches common desktop expectations and reduces appearance choice to a familiar mental model.
- **Alternative considered:** Keep the four existing brand themes and add a separate light/dark switch. Rejected because it compounds complexity instead of simplifying it.

### Decision 2: Resolve `System` into an applied theme in the provider layer
- **Choice:** The theme provider stores the user selection (`light`, `dark`, `system`) and also computes a resolved effective theme (`light` or `dark`) based on `prefers-color-scheme`.
- **Rationale:** UI components should not each re-implement system-theme logic; they should read a single resolved source of truth.
- **Alternative considered:** Store only the raw mode and let CSS/media queries fully decide rendering. Rejected because application code still needs a resolved theme for settings UI and runtime coordination.

### Decision 3: Keep EasyWork styling, but remap it into light/dark tokens
- **Choice:** Existing EasyWork styling tokens (`--ui-bg`, `--ui-panel`, `--ui-border`, etc.) remain the main abstraction layer, but they are now supplied from light/dark theme definitions rather than persona themes.
- **Rationale:** This minimizes churn while preserving EasyWork's product identity.
- **Alternative considered:** Replace all custom tokens with a completely generic theme stack. Rejected because it would create unnecessary rewrite scope.

### Decision 4: Use Codex-like appearance semantics in settings
- **Choice:** The appearance tab uses familiar labels and iconography for `Light`, `Dark`, and `System`.
- **Rationale:** Users should understand the setting instantly without learning EasyWork-specific theme names.
- **Alternative considered:** Keep EasyWork-specific names while changing the underlying logic. Rejected because the semantics would remain confusing.

## Risks / Trade-offs

- [Risk] Removing named themes may disappoint users who liked the older stylized presets.  
  → Mitigation: preserve EasyWork's tone within the new light/dark token sets rather than flattening everything into generic defaults.

- [Risk] System theme handling can drift if OS preference changes while the app is open.  
  → Mitigation: observe `prefers-color-scheme` changes and update resolved theme live while `system` mode is active.

- [Risk] Some screens may still implicitly assume old theme names.  
  → Mitigation: audit theme provider consumers and replace persona-name checks with mode-aware logic.

## Migration Plan

1. Update the shared UI theme context to support `light`, `dark`, and `system`.
2. Replace appearance settings UI copy and controls with the new three-mode selector.
3. Add or remap light/dark token definitions in global CSS.
4. Remove dependencies on old persona theme names from runtime selectors and settings-specific styling.
5. Verify theme persistence, system-follow behavior, and appearance consistency in task detail and settings flows.
