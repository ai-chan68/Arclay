import type { ApprovalCoordinatorResolveResult } from '../types/approval'
import type { TurnRecord } from '../types/turn-runtime'

const PERMISSION_TURN_STATES: TurnRecord['state'][] = [
  'executing',
  'awaiting_approval',
  'awaiting_clarification',
  'planning',
  'blocked',
]

const QUESTION_TURN_STATES: TurnRecord['state'][] = [
  'awaiting_clarification',
  'planning',
  'blocked',
  'queued',
  'executing',
]

const TERMINAL_TURN_STATES: TurnRecord['state'][] = [
  'cancelled',
  'failed',
  'completed',
]

function resolveApprovalTurnId(
  taskId: string | null,
  preferredStates: TurnRecord['state'][],
  findLatestTurnByTask: (
    taskId: string,
    states: TurnRecord['state'][]
  ) => { id: string } | null
): {
  turnId: string | null
  hasActiveTurn: boolean
} {
  if (!taskId) {
    return {
      turnId: null,
      hasActiveTurn: false,
    }
  }

  const activeTurn = findLatestTurnByTask(taskId, preferredStates)
  if (activeTurn?.id) {
    return {
      turnId: activeTurn.id,
      hasActiveTurn: true,
    }
  }

  const terminalTurn = findLatestTurnByTask(taskId, TERMINAL_TURN_STATES)
  return {
    turnId: terminalTurn?.id || null,
    hasActiveTurn: false,
  }
}

function resolveApprovalTurnIdOnly(
  taskId: string | null,
  preferredStates: TurnRecord['state'][],
  findLatestTurnByTask: (
    taskId: string,
    states: TurnRecord['state'][]
  ) => { id: string } | null
): string | null {
  return resolveApprovalTurnId(taskId, preferredStates, findLatestTurnByTask).turnId
}

export interface ResolvePermissionResponseInput {
  resolution: ApprovalCoordinatorResolveResult
  approved: boolean
  autoAllowUpdated: boolean
  autoAllowToolName: string | null
  findLatestTurnByTask: (
    taskId: string,
    states: TurnRecord['state'][]
  ) => { id: string } | null
}

export function resolvePermissionResponse(
  input: ResolvePermissionResponseInput
): {
  success: true
  approved: boolean
  status: ApprovalCoordinatorResolveResult['status']
  attachedToRuntime: boolean
  turnId: string | null
  autoAllowUpdated: boolean
  autoAllowToolName: string | null
} {
  return {
    success: true,
    approved: input.approved,
    status: input.resolution.status,
    attachedToRuntime: input.resolution.attachedToRuntime,
    turnId: resolveApprovalTurnIdOnly(
      input.resolution.record?.taskId || null,
      PERMISSION_TURN_STATES,
      input.findLatestTurnByTask
    ),
    autoAllowUpdated: input.autoAllowUpdated,
    autoAllowToolName: input.autoAllowToolName,
  }
}

export interface ResolveQuestionResponseInput {
  resolution: ApprovalCoordinatorResolveResult
  answers: Record<string, string>
  findLatestTurnByTask: (
    taskId: string,
    states: TurnRecord['state'][]
  ) => { id: string } | null
}

export function resolveQuestionResponse(
  input: ResolveQuestionResponseInput
): {
  success: true
  answers: Record<string, string>
  status: ApprovalCoordinatorResolveResult['status']
  attachedToRuntime: boolean
  canResume: boolean
  nextAction: 'resume_planning' | 'resume_execution' | null
  turnId: string | null
} {
  const turnTarget = resolveApprovalTurnId(
    input.resolution.record?.taskId || null,
    QUESTION_TURN_STATES,
    input.findLatestTurnByTask
  )
  const nextAction = turnTarget.hasActiveTurn
    ? input.resolution.record?.source === 'clarification'
      ? 'resume_planning'
      : 'resume_execution'
    : null

  return {
    success: true,
    answers: input.answers,
    status: input.resolution.status,
    attachedToRuntime: input.resolution.attachedToRuntime,
    canResume: turnTarget.hasActiveTurn,
    nextAction,
    turnId: turnTarget.turnId,
  }
}

export {
  PERMISSION_TURN_STATES,
  QUESTION_TURN_STATES,
  TERMINAL_TURN_STATES,
}
