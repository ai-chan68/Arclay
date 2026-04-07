/**
 * Shared plan-to-execution prompt helpers.
 * Keeps execution prompt formatting consistent between API route and scheduler.
 */

export interface PlanLikeStep {
  description: string
}

export interface PlanLike {
  goal: string
  steps: PlanLikeStep[]
  notes?: string
}

export function getPlanningFilesProtocolInstruction(): string {
  return `
## CRITICAL: History Ledger Protocol

Execution progress is recorded automatically to append-only history ledgers:
- Task ledger: sessions/<task_id>/history.jsonl
- Turn ledger: turns/<turn_id>/history.jsonl

Record progress through TodoWrite and normal tool usage. Do not create planning markdown files in the session directory.

Turn-level review files:
- The current turn may persist its own review template at \`turns/<turn_id>/evaluation.md\`.
- Do NOT create or overwrite a task-level \`evaluation.md\` in the session root.
- When the user asks whether a task/session met expectations, prefer the current turn's \`evaluation.md\` if it exists.
`
}

export function getMcpExecutionDisciplineInstruction(): string {
  return `
## CRITICAL: MCP Usage Boundaries

- Use only the MCP servers that are already available in this session or configured for the current application.
- Do NOT inspect other applications, caches, or unrelated config files to discover MCP servers.
- Do NOT scan the home directory or run broad filesystem searches such as \`find ~\` for MCP configuration.
- If the required MCP server is unavailable, report that it is not configured for the current application instead of performing environment archaeology.
`
}

export function formatPlanForExecutionFallback(plan: PlanLike, workDir: string): string {
  const stepsText = plan.steps
    .map((step, index) => `${index + 1}. ${step.description}`)
    .join('\n')

  return `
## CRITICAL: Workspace Configuration
**MANDATORY OUTPUT DIRECTORY: ${workDir}**

ALL files you create MUST be saved to this directory.
- ALWAYS use absolute paths starting with ${workDir}/
- NEVER use any other directory

## Execution Plan

**Goal:** ${plan.goal}

**Steps:**
${stepsText}

${plan.notes ? `**Notes:** ${plan.notes}\n` : ''}

## Instructions

Follow the plan above step by step. Execute each step completely before moving to the next.
Use the available tools to accomplish each step. Report progress as you complete each step.
All natural-language communication with the user must remain in Simplified Chinese unless the user explicitly requests another language.
${getPlanningFilesProtocolInstruction()}
${getMcpExecutionDisciplineInstruction()}

Begin execution now.
`
}

export function buildExecutionPrompt<TPlan extends PlanLike>(
  plan: TPlan,
  originalPrompt: string,
  workDir: string,
  formatter?: (plan: TPlan, workDir: string) => string
): string {
  const planPrompt = formatter
    ? formatter(plan, workDir)
    : formatPlanForExecutionFallback(plan, workDir)

  return `${planPrompt}\n\nOriginal request: ${originalPrompt}`
}
