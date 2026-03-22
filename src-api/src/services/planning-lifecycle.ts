import type { AgentMessage } from '@shared-types'
import type { PendingQuestion } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'

export interface AdvancePlanningTurnInput {
  activeTurn: TurnRecord | null
  markTurnAnalyzing: (turnId: string) => TurnTransitionResult
  markTurnPlanning: (turnId: string) => TurnTransitionResult
}

export interface AdvancePlanningTurnResult {
  status: 'noop' | 'ready' | 'blocked' | 'conflict'
  activeTurn: TurnRecord | null
  transitions: TurnTransitionResult[]
  conflictTransition: TurnTransitionResult | null
  errorMessage: string | null
}

export function advancePlanningTurn(
  input: AdvancePlanningTurnInput
): AdvancePlanningTurnResult {
  if (!input.activeTurn) {
    return {
      status: 'noop',
      activeTurn: null,
      transitions: [],
      conflictTransition: null,
      errorMessage: null,
    }
  }

  let activeTurn = input.activeTurn
  const transitions: TurnTransitionResult[] = []

  if (activeTurn.state === 'blocked') {
    return {
      status: 'blocked',
      activeTurn,
      transitions,
      conflictTransition: null,
      errorMessage: null,
    }
  }

  if (activeTurn.state === 'queued') {
    const analyzingState = input.markTurnAnalyzing(activeTurn.id)
    if (analyzingState.status === 'ok' && analyzingState.turn) {
      activeTurn = analyzingState.turn
      transitions.push(analyzingState)
    }
  }

  const planningState = input.markTurnPlanning(activeTurn.id)
  if (planningState.status === 'blocked' && planningState.turn) {
    activeTurn = planningState.turn
    transitions.push(planningState)
    return {
      status: 'blocked',
      activeTurn,
      transitions,
      conflictTransition: null,
      errorMessage: null,
    }
  }

  if (planningState.status !== 'ok' || !planningState.turn) {
    return {
      status: 'conflict',
      activeTurn,
      transitions,
      conflictTransition: planningState,
      errorMessage: planningState.reason || '回合状态冲突，无法进入规划阶段。',
    }
  }

  activeTurn = planningState.turn
  transitions.push(planningState)
  return {
    status: 'ready',
    activeTurn,
    transitions,
    conflictTransition: null,
    errorMessage: null,
  }
}

export interface HandlePreflightClarificationInput {
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
  now?: Date
  createMessageId: (prefix: string) => string
}

export interface HandlePreflightClarificationResult {
  status: 'continue' | 'awaiting_clarification' | 'limit_exceeded'
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  clarificationMessage: AgentMessage | null
  errorMessage: AgentMessage | null
}

export interface HandleBlockedClarificationLimitInput {
  hasPendingClarification: boolean
  nextRound: number
  maxClarificationRounds: number
  activeTurn: TurnRecord | null
  failTurn?: (turnId: string, reason?: string) => TurnTransitionResult
  now?: Date
  createMessageId: (prefix: string) => string
}

export interface HandleBlockedClarificationLimitResult {
  status: 'continue' | 'limit_exceeded'
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  errorMessage: AgentMessage | null
}

export function handleBlockedClarificationLimit(
  input: HandleBlockedClarificationLimitInput
): HandleBlockedClarificationLimitResult {
  if (!input.hasPendingClarification || input.nextRound <= input.maxClarificationRounds) {
    return {
      status: 'continue',
      activeTurn: input.activeTurn,
      turnTransition: null,
      errorMessage: null,
    }
  }

  const now = input.now || new Date()
  const message = `澄清轮次超过上限（${input.maxClarificationRounds}）。请补充更完整需求后重试。`
  const errorMessage: AgentMessage = {
    id: input.createMessageId('msg'),
    type: 'error',
    errorMessage: message,
    timestamp: now.getTime(),
  }

  let activeTurn = input.activeTurn
  let turnTransition: TurnTransitionResult | null = null
  if (activeTurn && input.failTurn) {
    turnTransition = input.failTurn(activeTurn.id, message)
    if (turnTransition.turn) {
      activeTurn = turnTransition.turn
    }
  }

  return {
    status: 'limit_exceeded',
    activeTurn,
    turnTransition,
    errorMessage,
  }
}

export function handlePreflightClarification(
  input: HandlePreflightClarificationInput
): HandlePreflightClarificationResult {
  const now = input.now || new Date()

  if (!input.preflightClarification) {
    return {
      status: 'continue',
      activeTurn: input.activeTurn,
      turnTransition: null,
      clarificationMessage: null,
      errorMessage: null,
    }
  }

  if (input.nextRound > input.maxClarificationRounds) {
    const message = `澄清轮次超过上限（${input.maxClarificationRounds}）。请补充更完整需求后重试。`
    const errorMessage: AgentMessage = {
      id: input.createMessageId('msg'),
      type: 'error',
      errorMessage: message,
      timestamp: now.getTime(),
    }

    let activeTurn = input.activeTurn
    let turnTransition: TurnTransitionResult | null = null
    if (activeTurn && input.failTurn) {
      turnTransition = input.failTurn(activeTurn.id, message)
      if (turnTransition.turn) {
        activeTurn = turnTransition.turn
      }
    }

    return {
      status: 'limit_exceeded',
      activeTurn,
      turnTransition,
      clarificationMessage: null,
      errorMessage,
    }
  }

  input.captureQuestionRequest(input.preflightClarification, {
    taskId: input.taskId,
    runId: input.runId,
    providerSessionId: input.runId,
    source: 'clarification',
    round: input.nextRound,
  })

  const clarificationMessage: AgentMessage = {
    id: input.createMessageId('msg'),
    type: 'clarification_request',
    role: 'assistant',
    content: input.preflightClarification.question,
    clarification: input.preflightClarification,
    question: input.preflightClarification,
    timestamp: now.getTime(),
  }

  let activeTurn = input.activeTurn
  let turnTransition: TurnTransitionResult | null = null
  if (activeTurn) {
    turnTransition = input.markTurnAwaitingClarification(activeTurn.id)
    if (turnTransition.turn) {
      activeTurn = turnTransition.turn
    }
  }

  return {
    status: 'awaiting_clarification',
    activeTurn,
    turnTransition,
    clarificationMessage,
    errorMessage: null,
  }
}
