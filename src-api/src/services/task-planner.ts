/**
 * TaskPlanner — 任务规划服务
 *
 * 负责 plan 的生命周期管理：
 * - formatForExecution(): 将 TaskPlan 格式化为执行 prompt（从 claude.ts 迁移）
 * - generate(): 委托 IAgent.plan() 生成 TaskPlan
 *
 * Web 执行策略注入通过 IntentClassifier 的 classifyWebIntent() 实现。
 */

import type { TaskPlan } from '../types/agent-new'
import type { AgentMessage } from '@shared-types'
import type { IAgent, AgentRunOptions } from '../core/agent/interface'
import { intentClassifier } from './intent-classifier'
import {
  getMcpExecutionDisciplineInstruction,
  getPlanningFilesProtocolInstruction,
} from './plan-execution'

export class TaskPlanner {
  /**
   * 将 TaskPlan 格式化为 Agent 执行 prompt。
   * 迁移自 ClaudeAgent.formatPlanForExecution()。
   */
  formatForExecution(plan: TaskPlan, workDir: string): string {
    const stepsText = plan.steps
      .map((step, index) => `${index + 1}. ${step.description}`)
      .join('\n')

    const corpus = [plan.goal, plan.notes, ...plan.steps.map((s) => s.description)]
      .filter((v): v is string => typeof v === 'string')
      .join('\n')
    const webIntent = intentClassifier.classifyWebIntent(corpus.toLowerCase())
    const webPolicy = getWebExecutionPolicyInstruction(webIntent)

    const initialTodos = plan.steps.map((step, index) => ({
      id: String(index + 1),
      content: step.description,
      status: 'pending',
    }))

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
Use the available tools to accomplish each step.
All natural-language communication with the user must remain in Simplified Chinese unless the user explicitly requests another language.
${getPlanningFilesProtocolInstruction()}
${getMcpExecutionDisciplineInstruction()}
${webPolicy}

## CRITICAL: Use TodoWrite Tool to Track Progress

You MUST use the TodoWrite tool to report your progress. This is required, not optional.

**When to call TodoWrite:**
1. IMMEDIATELY at the start - mark Step 1 as "in_progress" and all others as "pending"
2. When you START working on a step - mark it as "in_progress"
3. When you COMPLETE a step - mark it as "completed" and the next step as "in_progress"
4. When you FINISH all steps - mark the last step as "completed"

**Initial TodoWrite call (REQUIRED - do this first):**
Call TodoWrite with these todos:
\`\`\`json
${JSON.stringify(initialTodos, null, 2)}
\`\`\`

Then update the status as you progress through each step.
IMPORTANT: Use Read before the first Edit on any of them.
Do NOT use Write to replace task_plan.md, findings.md, or progress.md - use Edit or TodoWrite first.

## CRITICAL: Completion Verification (MANDATORY BEFORE STOPPING)

Before ending your execution, you MUST verify completion:
1. Review your latest TodoWrite state — are ALL items marked 'completed'?
2. If ANY item is still 'in_progress' or 'pending': DO NOT STOP — continue executing until done.
3. Only stop when ALL todos are 'completed', OR you encounter an unrecoverable error.
4. If you cannot complete a step due to an error, mark it 'failed' with a clear reason — NEVER leave it 'in_progress'.
5. Do NOT stop just because you feel you have done enough — verify the TodoWrite status first.
`
  }

  /**
   * 通过 agent 生成 TaskPlan。
   * agent.plan() 返回 AsyncIterable<AgentMessage>，调用方负责消费消息流
   * 并从 type='plan' 消息中提取 TaskPlan。
   */
  plan(
    agent: IAgent,
    prompt: string,
    options?: AgentRunOptions
  ): AsyncIterable<AgentMessage> | undefined {
    return agent.plan?.(prompt, options)
  }
}

export const taskPlanner = new TaskPlanner()

// --- Web 执行策略（从 claude.ts 迁移）---

type WebTaskIntent = 'none' | 'information_retrieval' | 'interaction' | 'hybrid'

function getWebExecutionPolicyInstruction(intent: WebTaskIntent): string {
  if (intent === 'none') return ''

  if (intent === 'information_retrieval') {
    return `
## Web Information Collection Policy

- When the goal is to gather or summarize information from the web, prefer the highest-information-density method first.
- Prefer direct text extraction, DOM inspection, structured fields, table parsing, or eval-style reads when they capture the needed facts clearly.
- Use screenshots when visual evidence is the clearest, most reliable, or most efficient way to capture the result.
- Capture screenshots for charts, canvases, hover states, visual diffs, maps, image-heavy pages, or when the screenshot is the best user-facing artifact.
- Avoid repetitive screenshots that do not add new information.
- If you are approaching the turn limit, return the facts already collected, explain what remains, and recommend the next step instead of ending silently.
`
  }

  if (intent === 'interaction') {
    return `
## Web Interaction Policy

- Use browser automation tools to complete the required interactions.
- Prefer targeted page reads and snapshots for element discovery instead of documenting every step visually.
- Capture screenshots at key state transitions, on errors, or when the user needs visual confirmation.
- Avoid repetitive screenshots after every interaction unless each screenshot adds new evidence.
`
  }

  return `
## Hybrid Web Task Policy

- Start with the highest-information-density method for information gathering.
- Switch to browser interaction only for the steps that require user-like actions.
- Use screenshots when visual evidence is the clearest artifact, and avoid repetitive screenshots that do not add new information.
- If execution stops early, return the facts gathered so far and identify the remaining interactive steps.
`
}
