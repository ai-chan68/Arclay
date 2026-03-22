import type { AgentMessage } from '@shared-types'
import type { PendingQuestion } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import { createErrorMessage } from './agent-stream-events'
import type {
  AdvancePlanningTurnResult,
  HandleBlockedClarificationLimitResult,
  HandlePreflightClarificationResult,
} from './planning-lifecycle'

export type PlanningEntryStatus =
  | 'continue'
  | 'blocked_done'
  | 'messages_done'
  | 'messages_turn_done'

export interface ResolvePlanningEntryInput {
  planningPrompt: string
  taskId?: string
  runId: string
  maxClarificationRounds: number
  activeTurn: TurnRecord | null
  hasPendingClarification: () => boolean
  getNextClarificationRound: () => number
  detectPreflightClarification: (prompt: string) => PendingQuestion | null
  advancePlanningTurn: (activeTurn: TurnRecord) => AdvancePlanningTurnResult
  handleBlockedClarificationLimit: (input: {
    hasPendingClarification: boolean
    nextRound: number
    maxClarificationRounds: number
    activeTurn: TurnRecord | null
    failTurn?: (turnId: string, reason?: string) => TurnTransitionResult
    createMessageId: (prefix: string) => string
  }) => HandleBlockedClarificationLimitResult
  handlePreflightClarification: (input: {
    preflightClarification: PendingQuestion | null
    nextRound: number
    maxClarificationRounds: number
    taskId?: string
    runId: string
    activeTurn: TurnRecord | null
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
    markTurnAwaitingClarification: (turnId: string) => TurnTransitionResult
    failTurn?: (turnId: string, reason?: string) => TurnTransitionResult
    createMessageId: (prefix: string) => string
  }) => HandlePreflightClarificationResult
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
  markTurnAwaitingClarification: (turnId: string) => TurnTransitionResult
  failTurn?: (turnId: string, reason?: string) => TurnTransitionResult
  createId: (prefix: string) => string
  preflightQuestion?: PendingQuestion | null
  now?: Date
}

export interface ResolvePlanningEntryResult {
  status: PlanningEntryStatus
  activeTurn: TurnRecord | null
  transitions: TurnTransitionResult[]
  turnTransition: TurnTransitionResult | null
  messages: AgentMessage[]
  blockedMessage: AgentMessage | null
  fallbackTurn: TurnRecord | null
}

function buildBlockedTurnUserMessage(blockedByTurnIds?: string[]): string {
  if (Array.isArray(blockedByTurnIds) && blockedByTurnIds.length > 0) {
    return `当前回合正在等待前序回合完成。依赖回合：${blockedByTurnIds.join(', ')}。请稍后重试。`
  }

  return '当前回合正在等待前序回合完成，请稍后重试。'
}

export function resolvePlanningEntry(
  input: ResolvePlanningEntryInput
): ResolvePlanningEntryResult {
  let activeTurn = input.activeTurn
  let transitions: TurnTransitionResult[] = []

  if (activeTurn) {
    const planningTurnResult = input.advancePlanningTurn(activeTurn)
    activeTurn = planningTurnResult.activeTurn
    transitions = planningTurnResult.transitions

    if (planningTurnResult.status === 'blocked') {
      const blockedClarificationLimitResult = input.handleBlockedClarificationLimit({
        hasPendingClarification: input.hasPendingClarification(),
        nextRound: input.getNextClarificationRound(),
        maxClarificationRounds: input.maxClarificationRounds,
        activeTurn,
        failTurn: input.failTurn,
        createMessageId: input.createId,
      })
      activeTurn = blockedClarificationLimitResult.activeTurn

      if (blockedClarificationLimitResult.status === 'limit_exceeded') {
        return {
          status: 'messages_turn_done',
          activeTurn,
          transitions: [],
          turnTransition: blockedClarificationLimitResult.turnTransition,
          messages: blockedClarificationLimitResult.errorMessage
            ? [blockedClarificationLimitResult.errorMessage]
            : [],
          blockedMessage: null,
          fallbackTurn: null,
        }
      }

      return {
        status: 'blocked_done',
        activeTurn,
        transitions,
        turnTransition: null,
        messages: [],
        blockedMessage: {
          id: input.createId('msg'),
          type: 'text',
          role: 'assistant',
          content: buildBlockedTurnUserMessage(activeTurn?.blockedByTurnIds),
          timestamp: (input.now || new Date()).getTime(),
        },
        fallbackTurn: activeTurn?.state === 'blocked' ? activeTurn : null,
      }
    }

    if (planningTurnResult.status === 'conflict') {
      return {
        status: 'messages_done',
        activeTurn,
        transitions: [],
        turnTransition: null,
        messages: [
          createErrorMessage(
            planningTurnResult.errorMessage || '回合状态冲突，无法进入规划阶段。',
            { createId: input.createId, now: input.now }
          ),
        ],
        blockedMessage: null,
        fallbackTurn: null,
      }
    }
  }

  const preflightClarification = input.detectPreflightClarification(input.planningPrompt)
  if (preflightClarification) {
    const preflightResult = input.handlePreflightClarification({
      preflightClarification,
      nextRound: input.getNextClarificationRound(),
      maxClarificationRounds: input.maxClarificationRounds,
      taskId: input.taskId,
      runId: input.runId,
      activeTurn,
      captureQuestionRequest: input.captureQuestionRequest,
      markTurnAwaitingClarification: input.markTurnAwaitingClarification,
      failTurn: input.failTurn,
      createMessageId: input.createId,
    })
    activeTurn = preflightResult.activeTurn

    if (preflightResult.status !== 'continue') {
      return {
        status: 'messages_turn_done',
        activeTurn,
        transitions: [],
        turnTransition: preflightResult.turnTransition,
        messages: [
          preflightResult.errorMessage,
          preflightResult.clarificationMessage,
        ].filter((message): message is AgentMessage => !!message),
        blockedMessage: null,
        fallbackTurn: null,
      }
    }
  }

  return {
    status: 'continue',
    activeTurn,
    transitions,
    turnTransition: null,
    messages: [],
    blockedMessage: null,
    fallbackTurn: null,
  }
}
