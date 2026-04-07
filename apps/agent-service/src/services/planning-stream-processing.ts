import type { AgentMessage } from '@shared-types'
import type { PendingQuestion, TaskPlan } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import { createErrorMessage } from './agent-stream-events'

export interface PlanningStreamState {
  planResult: TaskPlan | null
  isDirectAnswer: boolean
  directAnswer: string
  sawPlaceholderText: boolean
  clarificationLimitExceeded: boolean
}

export interface ProcessPlanningStreamMessageInput {
  message: AgentMessage
  planningState: PlanningStreamState
  maxClarificationRounds: number
  taskId?: string
  runId: string
  activeTurn: TurnRecord | null
  getNextClarificationRound: () => number
  captureQuestionRequest: (
    question: PendingQuestion,
    context: {
      taskId?: string
      runId: string
      providerSessionId: string
      source: 'clarification'
      round: number
    }
  ) => void
  capturePendingInteraction: (
    message: AgentMessage,
    context: {
      taskId?: string
      runId?: string
      providerSessionId?: string
    }
  ) => void
  upsertPendingPlan: (
    plan: TaskPlan,
    context: {
      taskId?: string
      runId?: string
      turnId?: string
    }
  ) => void
  failTurn: (turnId: string, reason?: string) => TurnTransitionResult
  createId: (prefix: string) => string
  now?: Date
}

export interface ProcessPlanningStreamMessageResult {
  planningState: PlanningStreamState
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  errorMessage: AgentMessage | null
  shouldBreak: boolean
  shouldForward: boolean
}

export function createPlanningStreamState(): PlanningStreamState {
  return {
    planResult: null,
    isDirectAnswer: false,
    directAnswer: '',
    sawPlaceholderText: false,
    clarificationLimitExceeded: false,
  }
}

function isLikelyPlanningPlaceholderText(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  if (text.length > 180) return false

  const lower = text.toLowerCase()
  const intentHints = [
    '我将', '我会', '我先', '我正在', '接下来', '让我',
    'i will', "i'll", 'let me', "i'm going to", 'i am going to',
  ]
  const actionHints = [
    '搜索', '查找', '分析', '整理', '汇总', '查询',
    'search', 'look up', 'analyze', 'summarize', 'collect',
  ]
  const conclusionHints = [
    '结论', '总结', '综上', '因此',
    'in summary', 'overall', 'therefore',
  ]

  const hasIntent = intentHints.some((hint) => text.includes(hint) || lower.includes(hint))
  const hasAction = actionHints.some((hint) => text.includes(hint) || lower.includes(hint))
  const hasConclusion = conclusionHints.some((hint) => text.includes(hint) || lower.includes(hint))

  return hasIntent && hasAction && !hasConclusion
}

export function processPlanningStreamMessage(
  input: ProcessPlanningStreamMessageInput
): ProcessPlanningStreamMessageResult {
  const planningState = {
    ...input.planningState,
  }
  let activeTurn = input.activeTurn
  let turnTransition: TurnTransitionResult | null = null
  let errorMessage: AgentMessage | null = null

  if (input.message.type === 'clarification_request') {
    const clarification = input.message.clarification || input.message.question
    if (clarification) {
      const nextRound = input.getNextClarificationRound()

      if (nextRound > input.maxClarificationRounds) {
        planningState.clarificationLimitExceeded = true
        errorMessage = createErrorMessage(
          `澄清轮次超过上限（${input.maxClarificationRounds}）。请补充更完整需求后重试。`,
          { createId: input.createId, now: input.now }
        )
        if (activeTurn) {
          const failed = input.failTurn(activeTurn.id, errorMessage.errorMessage)
          turnTransition = failed
          if (failed.turn) {
            activeTurn = failed.turn
          }
        }

        return {
          planningState,
          activeTurn,
          turnTransition,
          errorMessage,
          shouldBreak: true,
          shouldForward: false,
        }
      }

      input.captureQuestionRequest(clarification, {
        taskId: input.taskId,
        runId: input.runId,
        providerSessionId: input.runId,
        source: 'clarification',
        round: nextRound,
      })
    }
  } else {
    input.capturePendingInteraction(input.message, {
      taskId: input.taskId,
      runId: input.runId,
      providerSessionId: input.runId,
    })
  }

  if (input.message.type === 'plan' && input.message.plan) {
    const plan = input.message.plan as TaskPlan
    planningState.planResult = plan
    input.upsertPendingPlan(plan, {
      taskId: input.taskId,
      runId: input.runId,
      turnId: activeTurn?.id,
    })
  }

  if (input.message.type === 'text' && input.message.role === 'assistant') {
    const content = (input.message.content || '').trim()
    if (content) {
      planningState.directAnswer = content
      if (isLikelyPlanningPlaceholderText(content)) {
        planningState.sawPlaceholderText = true
      } else {
        planningState.isDirectAnswer = true
      }
    }
  }

  return {
    planningState,
    activeTurn,
    turnTransition,
    errorMessage,
    shouldBreak: false,
    shouldForward: input.message.type !== 'session',
  }
}
