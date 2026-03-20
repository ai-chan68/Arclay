## Purpose

Define the task detail workspace experience so EasyWork presents turn history, process evidence, and result artifacts in a master-detail layout that supports both live monitoring and retrospective review.

## Requirements

### Requirement: Turn Timeline Navigation Rail
The task detail workspace SHALL present task turns in a left-side vertical timeline that supports selecting a turn for detailed review.

#### Scenario: Viewing turn history as a timeline
- **WHEN** a task has one or more turns
- **THEN** the page shows a left-side vertical timeline of turns
- **AND** selecting a timeline node changes the selected turn shown in the detail area

### Requirement: Lightweight Timeline Summaries
Each timeline node SHALL show only lightweight navigational information consisting of timestamp and turn content summary.

#### Scenario: Scanning timeline summaries
- **WHEN** the timeline renders a turn node
- **THEN** the node shows the turn timestamp
- **AND** the node shows a concise content summary derived from the turn
- **AND** the node does not require full plan, full result, or verbose log content to remain visible

### Requirement: Recent-Turn Default Focus
The timeline SHALL show the five most recent turns by default and SHALL allow the user to expand older turns on demand.

#### Scenario: Task with more than five turns
- **WHEN** a task contains more than five turns
- **THEN** the timeline initially shows only the five most recent turns
- **AND** the interface provides an explicit control to reveal older turns

#### Scenario: Selected historical turn remains accessible
- **WHEN** the user selects a turn that belongs to the older hidden portion of history
- **THEN** the interface keeps that turn visible in the expanded timeline state
- **AND** the selected-turn highlight remains visible while the historical turn is under review

### Requirement: Selected Turn Process and Result Layout
The selected turn detail SHALL separate process-oriented content from result-oriented content in a two-column layout.

#### Scenario: Reviewing a selected turn
- **WHEN** the user opens a turn in the detail area
- **THEN** the detail area shows a process column and a result column
- **AND** the result column shows the turn's final output or produced artifacts

### Requirement: Selected Turn Header Avoids Content Duplication
The selected turn detail SHALL use its header for turn metadata and SHALL avoid repeating the same turn-intent content that is already presented in the user input section.

#### Scenario: Viewing a turn with explicit user input
- **WHEN** the selected turn includes a user input section
- **THEN** the header shows metadata such as turn index, timestamp, and status
- **AND** the interface does not duplicate the same intent text in both a large header summary and the user input section

### Requirement: Plan-Aware Process Column
The process column SHALL include the turn plan when one exists and SHALL omit the plan section when no plan exists for that turn.

#### Scenario: Turn with a plan
- **WHEN** the selected turn includes a plan
- **THEN** the process column shows a detailed `Plan` section
- **AND** the process column also shows a detailed `Thinking Process` section
- **AND** the `Plan` section appears as a first-class process section rather than being omitted behind other execution evidence

#### Scenario: Turn without a plan
- **WHEN** the selected turn has no plan
- **THEN** the detail area still shows the `Thinking Process` section
- **AND** the layout does not render an empty or placeholder plan module

### Requirement: Detailed Traceability for Plan and Thinking
The workspace SHALL present plan details and thinking/process details with enough fidelity to support retrospective review.

#### Scenario: Auditing execution intent and progress
- **WHEN** the user reviews a selected turn
- **THEN** the `Plan` section shows the relevant plan steps and statuses when a plan exists
- **AND** the `Thinking Process` section shows the sequence of meaningful execution actions for that turn

### Requirement: Failed Turns Preserve Available Plan Context
When a selected turn fails after a plan has been generated, the workspace SHALL continue to present the available plan context alongside the failure state.

#### Scenario: Reviewing a failed turn with a plan
- **WHEN** the selected turn is in a failed state
- **AND** the turn already contains a plan
- **THEN** the process region still shows the `Plan` section
- **AND** the failure notice does not replace the plan entirely

### Requirement: Error Surfaces Prefer Concrete Failure Detail
Task detail error surfaces SHALL prefer the most specific failure detail available for the current turn over generic provider-level fallback labels.

#### Scenario: Provider returns a concrete API failure
- **WHEN** the current turn contains a specific provider or runtime error detail such as an HTTP/API failure message
- **THEN** the task detail error notice shows that concrete detail as the primary user-facing explanation
- **AND** generic normalized provider markers remain secondary or fallback information

### Requirement: Unified Workspace Base Surface
The task detail workspace SHALL use a unified base surface across timeline, selected-turn detail, and preview regions, with hierarchy expressed through lightweight cards and separators.

#### Scenario: Viewing the task workspace with side panels visible
- **WHEN** the task detail page renders the left timeline, center detail area, and right preview pane together
- **THEN** the three regions share the same base workspace surface treatment
- **AND** the interface uses lightweight cards, borders, and spacing rather than separate heavy panel backgrounds to distinguish subregions

### Requirement: Collapsible Low-Level Logs
The workspace SHALL allow low-level logs inside the thinking/process section to be expanded or collapsed without hiding the higher-level process structure.

#### Scenario: Inspecting low-level execution details
- **WHEN** the selected turn contains verbose tool logs or raw outputs
- **THEN** the thinking/process section keeps the higher-level action structure visible
- **AND** the low-level logs are accessible behind expandable details

### Requirement: Stable Historical Review
The workspace SHALL support reviewing historical turns without forcing the detail area to auto-switch back to the newest turn.

#### Scenario: Reviewing an older turn during live execution
- **WHEN** the latest turn is still changing
- **AND** the user has selected an older turn
- **THEN** the detail area remains focused on the selected historical turn
- **AND** the historical review is not interrupted by automatic turn switching
