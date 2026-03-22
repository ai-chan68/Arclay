import type { TaskPlan } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'

export type PlanningCompletionStatus =
  | 'aborted'
  | 'limit_exceeded'
  | 'direct_answer'
  | 'awaiting_approval'
  | 'done'

export interface ResolvePlanningCompletionInput {
  runAborted: boolean
  clarificationLimitExceeded: boolean
  isDirectAnswer: boolean
  directAnswer: string
  planResult: TaskPlan | null
  activeTurn: TurnRecord | null
  cancelTurn: (turnId: string, reason?: string) => TurnTransitionResult
  completeTurn: (turnId: string, artifactContent?: string) => TurnTransitionResult
  markTurnAwaitingApproval: (turnId: string) => TurnTransitionResult
}

export interface ResolvePlanningCompletionResult {
  status: PlanningCompletionStatus
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
}

function resolveNextActiveTurn(
  currentTurn: TurnRecord | null,
  transition: TurnTransitionResult | null
): TurnRecord | null {
  if (!transition?.turn) {
    return currentTurn
  }
  return transition.turn
}

export function resolvePlanningCompletion(
  input: ResolvePlanningCompletionInput
): ResolvePlanningCompletionResult {
  let activeTurn = input.activeTurn

  if (input.runAborted) {
    const turnTransition = activeTurn
      ? input.cancelTurn(activeTurn.id, 'Planning aborted by user.')
      : null
    activeTurn = resolveNextActiveTurn(activeTurn, turnTransition)
    return {
      status: 'aborted',
      activeTurn,
      turnTransition,
    }
  }

  if (input.clarificationLimitExceeded) {
    return {
      status: 'limit_exceeded',
      activeTurn,
      turnTransition: null,
    }
  }

  if (input.isDirectAnswer && !input.planResult) {
    const turnTransition = activeTurn
      ? input.completeTurn(activeTurn.id, input.directAnswer)
      : null
    activeTurn = resolveNextActiveTurn(activeTurn, turnTransition)
    return {
      status: 'direct_answer',
      activeTurn,
      turnTransition,
    }
  }

  if (input.planResult && activeTurn) {
    const turnTransition = input.markTurnAwaitingApproval(activeTurn.id)
    activeTurn = resolveNextActiveTurn(activeTurn, turnTransition)
    return {
      status: 'awaiting_approval',
      activeTurn,
      turnTransition,
    }
  }

  return {
    status: 'done',
    activeTurn,
    turnTransition: null,
  }
}
