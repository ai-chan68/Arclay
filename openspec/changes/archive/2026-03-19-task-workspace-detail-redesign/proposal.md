## Why

EasyWork's task detail page still reads like a chat transcript even when a task spans multiple turns, approvals, tool invocations, and output artifacts. Users can inspect the raw history, but they cannot quickly reconstruct when each turn happened, what each turn was about, and how process evidence relates to the final result.

## What Changes

- Redesign task detail into a workspace layout with a left-side turn timeline and a right-side selected-turn detail view.
- Change turn navigation from top horizontal pills into a vertical timeline that emphasizes recency, timestamp, and per-turn content summary.
- Show only the most recent five turns by default and allow older turns to be expanded on demand.
- Reframe selected-turn detail around process vs. result instead of a single mixed message column.
- Keep plan and thinking/process sections detailed for traceability, while folding low-level execution logs behind expandable detail.
- Preserve support for turns without plans so simple conversational turns remain legible without forced empty modules.

## Capabilities

### New Capabilities
- `task-workspace-detail`: A task detail workspace that presents turn history as a time-based navigation rail and renders a selected turn with process-oriented and result-oriented detail areas.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/app/pages/TaskDetail.tsx`, `src/components/task-detail/TaskMessageList.tsx`, related task detail layout components, and any shared turn-summary helpers.
- Affected UX: task detail becomes a master-detail workspace instead of a message-first stream with horizontal turn pills.
- Affected state flow: selected turn state, selected turn summary, artifact preview, and runtime-log presentation must align with the new left-timeline/right-detail interaction model.
