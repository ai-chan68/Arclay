# Arclay Phase 1 Brand Rename Design

- **Date**: 2026-04-07
- **Topic**: Rename Arclay to Arclay at the brand-display layer
- **Status**: Design approved in conversation, pending written spec review

## 1. Background

The current product name `Arclay` is too generic for a desktop AI execution product. It reads like a broad productivity tool rather than a controlled execution assistant built around `Planning -> Approval -> Execution`.

The new brand name for the product is `Arclay`.

This first phase is intentionally limited to **brand-display changes only**. The goal is to let users see `Arclay` everywhere that matters without destabilizing persistence, packaging, or test infrastructure.

## 2. Goals

- Replace user-visible `Arclay` branding with `Arclay`.
- Keep the rollout low risk.
- Avoid breaking local user data, config paths, tests, release scripts, or desktop packaging.
- Create a clean boundary between branding work and future technical identity migration.

## 3. Non-Goals

This phase does **not** rename internal technical identifiers.

The following must remain unchanged in phase 1:

- Tauri app identifier: `com.arclay.app`
- Home/config directory: `~/.arclay`
- Desktop database file: `arclay.db`
- Sidecar binary name: `arclay-api`
- Environment variables: `ARCLAY_*`
- Workspace package scope: `@arclay/*`
- Web storage keys and IndexedDB names using `arclay`

This phase also does not include:

- Data migration from old paths to new paths
- Binary renaming
- Bundle identifier migration
- CI/CD variable migration
- Store listing, domain, or repository rename

## 4. Recommended Approach

Use a **display-name-only rename**:

- `Arclay` becomes the primary visible product name.
- Existing internal identifiers remain on `arclay` for compatibility.
- Documentation should clearly describe `Arclay` as the product while leaving technical setup paths unchanged where required.

This approach is preferred because it preserves:

- Existing local user data
- Existing app install identity
- Existing build and test scripts
- Existing sidecar integration

## 5. Change Scope

### 5.1 User-visible application surfaces

Update branding on the following surfaces:

- Desktop window title
- Tauri `productName`
- Web page `<title>`
- Welcome page brand label
- Other obvious in-app labels that expose `Arclay` as a product name

### 5.2 Documentation and descriptive copy

Update product naming in:

- `README.md`
- `README.zh-CN.md`
- `docs/getting-started.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `LICENSE`

When docs mention technical paths or runtime identifiers, they must remain unchanged if they are still true in phase 1, for example:

- `~/.arclay/settings.json`
- `arclay.db`
- `arclay-api`

### 5.3 Explicitly deferred internal naming

Do not change naming in:

- Rust crate/package names
- npm workspace package names
- sidecar executable names
- environment variable names
- IndexedDB names
- localStorage keys
- test fixture prefixes and temp directory prefixes

## 6. Target Files

Expected phase-1 edits should be limited to this set unless additional user-visible references are found during implementation:

- `apps/web/index.html`
- `apps/web/app/pages/Welcome.tsx`
- `apps/desktop/tauri.conf.json`
- `README.md`
- `README.zh-CN.md`
- `docs/getting-started.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `LICENSE`

## 7. Copy Rules

- Primary product name: `Arclay`
- Keep the existing descriptive positioning unless a label becomes awkward after rename.
- Do not rename technical objects just to make the copy visually consistent.
- If a sentence mixes product branding and technical paths, prefer wording such as:
  - "`Arclay` stores runtime configuration in `~/.arclay/settings.json`."

## 8. Risks and Mitigations

### Risk: accidental technical rename

Large search-and-replace operations may change internal identifiers such as `arclay-api` or `@arclay/*`.

Mitigation:

- Use targeted edits only.
- Treat all lowercase `arclay` tokens as suspicious by default.

### Risk: documentation drift

Docs may become misleading if branding is changed while technical paths remain unchanged.

Mitigation:

- Review every path example manually.
- Keep compatibility notes explicit where needed.

### Risk: mixed branding in UI

Some visible strings may still say `Arclay` after the main rename.

Mitigation:

- Run a targeted search for user-visible `Arclay` references after edits.

## 9. Verification

Minimum verification for phase 1:

- Search confirms user-visible `Arclay` branding was replaced in intended files.
- Search confirms protected technical identifiers still use `arclay`.
- Desktop config still references `com.arclay.app` and `arclay-api`.
- Docs still point to `~/.arclay/settings.json` where applicable.

Recommended commands during implementation:

```bash
rg -n "Arclay" apps/web apps/desktop README.md README.zh-CN.md docs ARCHITECTURE.md CONTRIBUTING.md LICENSE
rg -n "com\\.arclay\\.app|arclay-api|~/.arclay|arclay\\.db|@arclay/|ARCLAY_" apps packages e2e scripts README.md README.zh-CN.md docs
```

## 10. Success Criteria

Phase 1 is complete when:

- Users see `Arclay` as the product name in primary UI and docs.
- No user data path or app identity is broken.
- No technical migration is introduced implicitly.
- The codebase remains ready for a separate future phase that may rename technical identifiers with explicit migration logic.
