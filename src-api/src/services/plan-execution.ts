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
## CRITICAL: Planning Files Protocol

The execution workspace includes these persistent files:
- task_plan.md
- findings.md
- progress.md

You MUST keep them updated during execution:
1. At the start of each step, update task_plan.md status and current phase.
2. After meaningful discoveries, append key facts and decisions to findings.md.
3. After each completed step (and on every error), append progress details to progress.md.
4. Record every failure and resolution attempt in task_plan.md and progress.md.
5. Never delete these files.

These files are pre-created before execution starts:
- Use Read before the first Edit on any of them.
- Do NOT use Write to replace task_plan.md, findings.md, or progress.md.
- Prefer Edit for targeted updates so concurrent progress logging remains stable.
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
