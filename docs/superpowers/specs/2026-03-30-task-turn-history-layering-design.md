# Task/Turn History Layering Design

## Context

The current task workspace mixes several concerns:

- `sessions/<taskId>/history.jsonl` acts as the task-wide execution ledger.
- `turns/<turnId>/turn.json` acts as a turn snapshot for UI/recovery.
- `task_plan.md`, `progress.md`, and `findings.md` aggregate process notes across turns in task root.

This leads to overlapping process artifacts and unclear ownership between task-level and turn-level state.

## Goals

- Keep a single task-level file that can show the full task journey end to end.
- Make each turn self-contained for replay, debugging, and recovery.
- Keep `turn.json` as a stable structured snapshot, not an event log.
- Remove long-term dependency on `task_plan.md`, `progress.md`, and `findings.md`.
- Preserve compatibility and allow incremental rollout.

## Non-Goals

- Redesign the task/turn runtime model.
- Replace existing memory or daily-summary features in this phase.
- Remove the task-level history ledger.

## Decision Summary

### Decision 1: Introduce dual-layer history

Use both:

- `sessions/<taskId>/history.jsonl` as the task-wide ledger
- `sessions/<taskId>/turns/<turnId>/history.jsonl` as the turn-local ledger

Rationale:

- The task ledger satisfies the requirement to inspect the whole task in one file.
- The turn ledger makes each turn self-contained.

### Decision 2: Keep `turn.json` as a snapshot only

`turn.json` remains the structured snapshot for one turn. It should store final or derived state such as:

- `turn`
- `summaryText`
- `planSnapshot`
- `output`
- `updatedAt`

It must not become a full event log.

### Decision 3: Retire task-root process markdown files

`task_plan.md`, `progress.md`, and `findings.md` should be phased out after the new history layering is in place and consumers no longer depend on them.

## Storage Model

### Task Scope

#### `sessions/<taskId>/history.jsonl`

Purpose:

- Single-file, append-only task ledger
- Human-readable end-to-end task timeline
- Input for task-wide replay, audit, and daily-summary generation

Required fields per record:

- `timestamp`
- `taskId`
- `turnId`
- `runId`
- `type`
- `content`
- `metadata`

Must not store:

- turn snapshot payloads
- artifact lists
- mutable task summary objects

### Turn Scope

#### `sessions/<taskId>/turns/<turnId>/history.jsonl`

Purpose:

- Append-only event stream for one turn
- Source for single-turn replay/debugging
- Rebuild source for turn-level recovery if needed

Record schema:

- Same schema as task history records

Must not store:

- cross-turn aggregates
- task-level summary state
- data from other turns

#### `sessions/<taskId>/turns/<turnId>/turn.json`

Purpose:

- Structured turn snapshot for UI, recovery, and artifact indexing

Should store:

- turn identity and state
- plan snapshot
- output summary
- artifact references
- derived status/metrics if needed later

Must not store:

- raw event-by-event trace
- verbose tool transcript
- task-wide process aggregation

## Source of Truth

- `turns/<turnId>/history.jsonl` is the source of truth for turn event flow.
- `sessions/<taskId>/history.jsonl` is the source of truth for task-wide aggregated event flow.
- `turn.json` is a derived snapshot, not the process ledger.

## Write Flow

For each emitted execution/planning event:

1. Append the record to `turns/<turnId>/history.jsonl`
2. Append the same normalized record to `sessions/<taskId>/history.jsonl`
3. At planning/execution milestones or at turn completion, refresh `turns/<turnId>/turn.json`

Rules:

- Both history files are append-only.
- Task and turn history records must be schema-identical.
- Each record must include `taskId`, `turnId`, and `runId`.
- `turn.json` should be updated at stable checkpoints, not per event.

## Recovery Rules

- If task history is missing, rebuild it by merging all turn histories ordered by timestamp.
- If turn snapshot is missing, rebuild it from the turn history plus stored artifacts.
- If turn history is missing but task history exists, recover turn-local history by filtering task records by `turnId`.

## Impact on Existing Files

After rollout:

- Process visibility comes from `history.jsonl`
- Turn outcome visibility comes from `turn.json`
- `task_plan.md`, `progress.md`, and `findings.md` are no longer primary data carriers

This separates process logging from snapshot storage and removes the need for task-root process markdown aggregation.

## Migration Strategy

### Phase 1: Dual-write

- Add `turns/<turnId>/history.jsonl`
- Continue writing `sessions/<taskId>/history.jsonl`
- Keep existing markdown files and current UI behavior

### Phase 2: Consumer migration

- Switch turn detail views and recovery paths to use turn-local history plus `turn.json`
- Keep task-level history as the main full-task ledger
- Stop depending on task-root markdown files for process display

### Phase 3: Markdown retirement

- Stop bootstrapping `task_plan.md`, `progress.md`, and `findings.md`
- Remove prompt instructions that require the agent to maintain them
- Remove their privileged UI treatment
- Keep backward-compatible read-only support for older tasks during transition

## Error Handling

- Missing task ledger: reconstruct from turn ledgers
- Missing turn ledger: reconstruct from task ledger filtered by `turnId`
- Missing snapshot: reconstruct from turn ledger and artifact state
- Partial dual-write failure: prefer turn ledger as recovery baseline for a single turn, task ledger for task-wide replay

## Testing Strategy

- Verify dual-write creates both task and turn history files with identical normalized records.
- Verify task ledger preserves full chronological order across multiple turns.
- Verify turn detail can render from `turn/history.jsonl + turn.json` without task-root markdown files.
- Verify task history can be rebuilt from turn histories.
- Verify turn history can be backfilled from task history by `turnId`.
- Verify old tasks without turn-local history remain readable during migration.

## Open Follow-Up

- Decide whether task history is written directly during execution or rebuilt incrementally from turn history append events.
- Decide whether any task-wide summary artifact should replace the human-readable role previously played by `task_plan.md`, `progress.md`, and `findings.md`.
