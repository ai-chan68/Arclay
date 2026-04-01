# Spec: README.md Update (Harness Engineering Focus)

**Date:** 2026-04-01
**Topic:** Updating main README to reflect latest practices in Harness Engineering, Local Workflow, and Runtime optimizations.

## 1. Goal
Align the project documentation with the latest code implementation and the core philosophy of "Harness Engineering". Show that EasyWork is a professional workbench for *executing* tasks, not just chatting.

## 2. Key Sections to Add/Modify

### 2.1 Harness Engineering (New Core Section)
- **Concept**: "Agent is the model, Harness is the code."
- **Action Space**: Precise tool design (Micro, Medium, Macro granularity).
- **Observation**: Structured tool outputs (success/warning/error) for autonomous recovery.
- **Error Recovery Contract**: Pattern: `root_cause_hint + safe_retry_instruction + stop_condition`.

### 2.2 Enhanced Local Workflow (Modified)
- **Sandbox**: Mention native execution with permission enforcement.
- **MCP Support**: Dynamic integration and discovery boundaries.
- **Skills Router**: Skill routing for better prompt context management.

### 2.3 Runtime Optimizations (Modified/New)
- **Bash Tool**: Separate stdout/stderr, error contracts for timeouts and missing binaries.
- **Context Budgeting**: Conversation history truncation and token management.
- **Claude Agent SDK Integration**: Deep integration for high reliability.

### 2.4 Quick Start & Commands (Updated)
- Ensure `pnpm dev:all` and build commands are accurate.
- Update port information and settings storage paths.

## 3. Structure Outline
1. Project Title & Mission
2. Harness Engineering Philosophy (NEW)
3. Core Features (Updated: Workspace, Planning, Execution)
4. Local Ecosystem (Sandbox, MCP, Skills)
5. Quick Start (Web & Desktop)
6. Runtime Settings & Data Flow
7. Contribution & License

## 4. Rationale
This structure prioritizes the project's unique value proposition: the engineering discipline behind high-reliability agent execution. It differentiates EasyWork from generic LLM wrappers.
