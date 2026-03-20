## Context

The current task detail experience groups messages into turns, but still renders the task primarily as a message surface with a sticky horizontal turn selector. That interaction works for short histories, yet it weakens temporal understanding once a task accumulates multiple turns, retries, approvals, or resumptions.

During exploration we aligned on a stronger workspace metaphor:

- The left side should answer "when and what was this turn about?"
- The right side should answer "how did this turn proceed and what did it produce?"
- Traceability matters: plan and thinking/process need to stay detailed, not collapsed into shallow summary cards.
- Raw logs still matter, but they should not dominate the first reading pass.

## Goals / Non-Goals

**Goals:**
- Replace top-level horizontal turn pills with a vertical time-based navigation rail.
- Keep the timeline lightweight by showing only timestamp and content summary per node.
- Default the timeline to the most recent five turns and reveal older history only when requested.
- Render the selected turn as a stable right-side detail panel.
- Keep plan and thinking/process sections detailed enough for review and retrospection.
- Separate process information from result information so the page reads like execution evidence plus output.
- Preserve visual rhythm and layout stability across turns with or without plans.

**Non-Goals:**
- Redefine backend turn grouping or runtime persistence.
- Remove raw execution logs or deep debugging detail.
- Introduce a different mobile-first task detail IA in this change.
- Turn the left timeline into a second full detail surface.

## Decisions

### Decision 1: Use a master-detail desktop layout
- **Choice:** The page uses a left navigation rail for turn timeline and a right detail area for the selected turn.
- **Rationale:** This keeps turn history continuously visible while giving one turn enough space to show process and result in depth.
- **Alternative considered:** Keep timeline above detail as a horizontal strip. Rejected because it compresses multi-turn history into tabs instead of a temporal narrative.

### Decision 2: Keep the left timeline intentionally sparse
- **Choice:** Each timeline node shows only timestamp and content summary, with older turns collapsed behind a "view earlier turns" control once the count exceeds five.
- **Rationale:** The left rail should behave like a navigable index, not compete with the selected-turn detail.
- **Alternative considered:** Add status chips, tool counts, and artifact badges to every timeline row. Rejected because it makes the rail visually heavy and reduces scan speed.

### Decision 3: Organize selected-turn detail as process vs. result
- **Choice:** The right detail area uses a two-column composition where the result always occupies one column and the process occupies the other.
- **Rationale:** Users need to differentiate how the turn progressed from what it ultimately produced.
- **Alternative considered:** Keep one stacked single-column card. Rejected because it blends execution evidence and final output into a single reading stream.

### Decision 4: Preserve a stable right-side skeleton across turn types
- **Choice:** The right side keeps a stable two-column layout; when a turn has a plan, the process column contains both `Plan` and `Thinking Process`, and when a turn has no plan, the process column contains only `Thinking Process`.
- **Rationale:** Stable page bones improve perceived coherence and avoid making each selected turn feel like a different page.
- **Alternative considered:** Switch between unrelated layouts for plan vs. non-plan turns. Rejected because the page would feel jumpy and structurally inconsistent.

### Decision 5: Treat plan and thinking as detailed trace surfaces
- **Choice:** `Plan` and `Thinking Process` remain expanded, information-rich sections. Only low-level execution logs within the thinking section are collapsible.
- **Rationale:** Traceability is a first-class requirement for reviewing task behavior, especially across complex turns.
- **Alternative considered:** Collapse the entire thinking section by default and show only a summary count. Rejected because it undermines auditability and makes recovery/debugging slower.

### Decision 6: Distinguish live latest-turn viewing from historical review
- **Choice:** When the selected turn is the latest turn, its detail can continue reflecting live updates; when a historical turn is selected, the right-side detail acts as a stable historical view rather than following the latest stream.
- **Rationale:** Users reviewing history should not lose context because a currently running turn keeps updating elsewhere.
- **Alternative considered:** Always auto-follow the newest turn. Rejected because it disrupts retrospective reading.

### Decision 7: Keep the selected-turn header metadata-only
- **Choice:** The selected-turn header should show lightweight metadata such as turn number, timestamp, and status, but must not restate the same intent text already shown in the user input section.
- **Rationale:** Repeating the turn summary in both a large header block and a user-input block wastes vertical space and weakens information hierarchy.
- **Alternative considered:** Keep a large summary headline above the detail body. Rejected because it duplicates user intent without adding new evidence.

### Decision 8: Treat plan as a required first-class process section when available
- **Choice:** For turns that contain a plan, the process column must render `Plan` before `Thinking Process` rather than relying on thinking traces alone to explain execution.
- **Rationale:** Plan is the user's clearest reference for intended execution order and completion state; omitting it makes retrospective review incomplete.
- **Alternative considered:** Infer intent from thinking/tool traces and show plan only opportunistically. Rejected because it hides the planned-vs-actual distinction.

### Decision 9: Preserve plan visibility in failed turns
- **Choice:** When a turn fails after a plan has already been generated, the selected-turn detail continues rendering the `Plan` section instead of replacing the entire process surface with a generic failure card.
- **Rationale:** Planning intent remains critical evidence during failure review; hiding it makes the user lose the clearest reference for what the turn was supposed to do next.
- **Alternative considered:** Collapse all process content into a single failure state. Rejected because it trades clarity for simplification and weakens retrospective debugging.

### Decision 10: Prefer concrete failure detail over provider-level generic errors
- **Choice:** Task-detail error surfaces should prefer the most specific failure detail available in the current turn, such as provider HTTP error text or runtime failure text, and only fall back to abstract provider markers when no richer detail exists.
- **Rationale:** Users need actionable failure feedback. A generic `PROVIDER_ERROR` or custom endpoint marker is useful for tracing internally, but it is not the best primary explanation for UI.
- **Alternative considered:** Always display the final normalized provider error string. Rejected because it hides important operational detail such as authentication, quota, or rate-limit failures.

### Decision 11: Keep the workspace on a unified base surface
- **Choice:** The left navigation rail, central task detail area, and right preview area should share the same base workspace surface, while hierarchy is expressed through lightweight cards, separators, and spacing rather than independent panel backgrounds.
- **Rationale:** The task workspace should read as one coordinated desktop surface. Heavy side-panel differentiation makes the layout feel fragmented and visually louder than necessary.
- **Alternative considered:** Keep distinct sidebar backgrounds to emphasize separation. Rejected because the new master-detail structure already provides enough spatial separation without requiring different base plates.

## Risks / Trade-offs

- [Risk] The left timeline may feel too sparse if summaries are poorly generated.  
  → Mitigation: derive timeline text primarily from user intent and only fall back to plan/result text when needed.

- [Risk] The right detail pane could become visually heavy because both process and result are detailed.  
  → Mitigation: keep a stable column system, maintain strong typography hierarchy, and fold only low-level logs.

- [Risk] The detail area may accidentally duplicate the same turn-intent text across multiple sections.  
  → Mitigation: limit the header to metadata and keep turn intent anchored in the user-input section.

- [Risk] Turns with very long results may overpower the process column.  
  → Mitigation: treat the result column as a reading surface while preserving clear section headers and spacing in the process column.

- [Risk] Expanded older history may create confusion about which turn is active.  
  → Mitigation: keep a strong selected state in the timeline and prevent hiding the selected turn when it lives in the expanded older set.

- [Risk] Preserving plan in failed turns could make failure states visually denser.  
  → Mitigation: keep the failure notice concise and treat plan as the only required companion section in the failed state.

- [Risk] Preferring raw provider detail could expose noisy wording in some cases.  
  → Mitigation: prioritize detailed but human-readable failure text and keep normalized provider markers as fallback detail rather than the primary summary.

## Migration Plan

1. Introduce the new task detail layout shell with left timeline and right selected-turn detail region.
2. Refactor existing turn navigation state to drive the new timeline interaction.
3. Convert selected-turn rendering into explicit process/result sections while reusing existing grouped turn data.
4. Add collapsed older-turn behavior for timeline histories longer than five turns.
5. Refine section hierarchy, spacing, and collapse behavior so detail remains traceable without overwhelming the page.

## Open Questions

- Should timeline timestamps show absolute date plus time for cross-day tasks, or switch format only when turns span multiple days?
- Should the result column prioritize rendered markdown, file preview, or artifact summary when multiple result forms exist in one turn?
- How aggressively should the UI preserve expanded thinking-log state when switching between turns?
