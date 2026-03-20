## 1. Layout Foundation

- [x] 1.1 Replace the existing top turn pill navigation with a left-side vertical timeline shell in task detail.
- [x] 1.2 Add timeline state behavior for showing the most recent five turns by default and expanding older history on demand.
- [x] 1.3 Preserve selected-turn visibility and highlight behavior when the selected turn comes from expanded older history.

## 2. Selected Turn Detail

- [x] 2.1 Refactor selected-turn rendering into a stable two-column detail layout with process and result regions.
- [x] 2.2 Render a detailed `Plan` section in the process region only when the selected turn includes a plan.
- [x] 2.3 Render a detailed `Thinking Process` section that keeps the action sequence visible while supporting collapsible low-level logs.
- [x] 2.4 Render the selected turn's final result and artifact/output content in the result region.
- [x] 2.5 Reduce selected-turn header duplication so user intent is not restated in both the header and the user input section.

## 3. Interaction and State Consistency

- [x] 3.1 Ensure latest-turn viewing can continue to update live without disrupting historical turn review.
- [x] 3.2 Keep selected-turn summary, artifact preview, and runtime evidence aligned with timeline selection changes.
- [x] 3.3 Polish spacing, hierarchy, and visual balance so the lightweight timeline and detailed right pane feel like one coordinated workspace.
- [x] 3.4 Keep plan context visible when a turn fails after planning has completed.
- [x] 3.5 Prefer concrete provider/runtime failure detail in task detail error surfaces over generic fallback markers.
- [x] 3.6 Unify the base surface across timeline, detail, and preview regions while keeping only lightweight card layers for local grouping.
