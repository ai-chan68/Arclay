import type { AgentMessage } from '@shared-types'
import type { TaskPlan } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import { resolvePlanningCompletion, type PlanningCompletionStatus } from './planning-completion'
import type { PlanningStreamState } from './planning-stream-processing'

export interface ResolvePlanningPostRunInput {
  prompt: string
  planningState: PlanningStreamState
  runAborted: boolean
  activeTurn: TurnRecord | null
  taskId?: string
  runId: string
  upsertPendingPlan: (
    plan: TaskPlan,
    context: {
      taskId?: string
      runId?: string
      turnId?: string
    }
  ) => void
  cancelTurn: (turnId: string, reason?: string) => TurnTransitionResult
  completeTurn: (turnId: string, artifactContent?: string) => TurnTransitionResult
  markTurnAwaitingApproval: (turnId: string) => TurnTransitionResult
  createId: (prefix: string) => string
  now?: Date
}

export interface ResolvePlanningPostRunResult {
  status: PlanningCompletionStatus
  planningState: PlanningStreamState
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  messages: AgentMessage[]
}

function createFallbackPlanningPlan(
  prompt: string,
  createId: (prefix: string) => string,
  rawText?: string
): TaskPlan {
  const trimmed = (rawText || '').trim()
  const summary = trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed
  const notes = [
    '规划阶段返回了说明性文本，已自动生成兜底计划以继续审批流程。',
    summary ? `原始文本摘要：${summary}` : '',
  ].filter(Boolean).join(' ')

  return {
    id: createId('plan'),
    goal: prompt,
    steps: [
      { id: 'step_0', description: '收集完成任务所需的信息和上下文', status: 'pending' },
      { id: 'step_1', description: '执行核心步骤并产出中间结果', status: 'pending' },
      { id: 'step_2', description: '校验结果并整理最终输出', status: 'pending' },
    ],
    notes,
    createdAt: new Date(),
  }
}

function createFallbackPlanMessage(
  plan: TaskPlan,
  createId: (prefix: string) => string,
  now: Date
): AgentMessage {
  return {
    id: createId('msg'),
    type: 'plan',
    role: 'assistant',
    content: `已生成执行计划，共 ${plan.steps.length} 个步骤`,
    timestamp: now.getTime(),
    plan,
  }
}

export function resolvePlanningPostRun(
  input: ResolvePlanningPostRunInput
): ResolvePlanningPostRunResult {
  const now = input.now || new Date()
  let planningState = input.planningState
  const messages: AgentMessage[] = []

  if (!planningState.planResult && planningState.sawPlaceholderText && !planningState.isDirectAnswer) {
    const fallbackPlan = createFallbackPlanningPlan(input.prompt, input.createId, planningState.directAnswer)
    planningState = {
      ...planningState,
      planResult: fallbackPlan,
    }
    input.upsertPendingPlan(fallbackPlan, {
      taskId: input.taskId,
      runId: input.runId,
      turnId: input.activeTurn?.id,
    })
    messages.push(createFallbackPlanMessage(fallbackPlan, input.createId, now))
  }

  const completionResult = resolvePlanningCompletion({
    runAborted: input.runAborted,
    clarificationLimitExceeded: planningState.clarificationLimitExceeded,
    isDirectAnswer: planningState.isDirectAnswer,
    directAnswer: planningState.directAnswer,
    planResult: planningState.planResult,
    activeTurn: input.activeTurn,
    cancelTurn: input.cancelTurn,
    completeTurn: input.completeTurn,
    markTurnAwaitingApproval: input.markTurnAwaitingApproval,
  })

  return {
    status: completionResult.status,
    planningState,
    activeTurn: completionResult.activeTurn,
    turnTransition: completionResult.turnTransition,
    messages,
  }
}
