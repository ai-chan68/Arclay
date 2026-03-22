import type { AgentRunStopResult, AgentRunStopOptions } from './agent-run-store'
import type { ApprovalListFilter } from '../types/approval'
import type { PlanRecord } from '../types/plan-store'
import type { TurnRecord } from '../types/turn-runtime'

const STOPPABLE_TURN_STATES: TurnRecord['state'][] = [
  'analyzing',
  'planning',
  'awaiting_approval',
  'awaiting_clarification',
  'executing',
  'blocked',
  'queued',
]

export interface StopAgentSessionInput<TTurn extends { id: string }> {
  sessionId: string
  stopRun: (
    sessionId: string,
    options: AgentRunStopOptions<TTurn>
  ) => AgentRunStopResult
  abortAgentSession?: (sessionId: string) => boolean
  findLatestTurnByRun?: (
    runId: string,
    states: TurnRecord['state'][]
  ) => TTurn | null
  cancelTurn?: (turnId: string, reason?: string) => void
  cancelPendingApprovals?: (
    scope: Omit<ApprovalListFilter, 'status'>,
    reason: string
  ) => number
}

function hasApprovalScope(scope: Omit<ApprovalListFilter, 'status'>): boolean {
  return Boolean(scope.taskId || scope.runId || scope.providerSessionId)
}

export function stopAgentSession<TTurn extends { id: string }>(
  input: StopAgentSessionInput<TTurn>
): AgentRunStopResult {
  const result = input.stopRun(input.sessionId, {
    abortAgentSession: input.abortAgentSession,
    findLatestTurnByRun: input.findLatestTurnByRun
      ? (runId) => input.findLatestTurnByRun?.(runId, STOPPABLE_TURN_STATES) || null
      : undefined,
    cancelTurn: input.cancelTurn,
  })

  const approvalScope: Omit<ApprovalListFilter, 'status'> = {
    runId: input.sessionId,
    providerSessionId: input.sessionId,
  }
  if (result.status === 'stopped' && input.cancelPendingApprovals && hasApprovalScope(approvalScope)) {
    input.cancelPendingApprovals(approvalScope, 'Session stopped by user.')
  }

  return result
}

export interface RejectPendingPlanInput {
  planId: string
  reason?: string
  markRejected: (planId: string, reason?: string) => PlanRecord | null
  cancelTurn: (turnId: string, reason?: string) => void
  cancelPendingApprovals?: (
    scope: Omit<ApprovalListFilter, 'status'>,
    reason: string
  ) => number
}

export type RejectPendingPlanResult =
  | { status: 'not_found' }
  | { status: 'rejected'; record: PlanRecord }

export function rejectPendingPlan(
  input: RejectPendingPlanInput
): RejectPendingPlanResult {
  const record = input.markRejected(input.planId, input.reason)
  if (!record) {
    return { status: 'not_found' }
  }

  if (record.turnId) {
    input.cancelTurn(record.turnId, input.reason || 'Plan rejected by user.')
  }

  const approvalScope: Omit<ApprovalListFilter, 'status'> = {
    taskId: record.taskId || undefined,
    runId: record.runId || undefined,
    providerSessionId: record.runId || undefined,
  }
  if (input.cancelPendingApprovals && hasApprovalScope(approvalScope)) {
    input.cancelPendingApprovals(approvalScope, input.reason || 'Plan rejected by user.')
  }

  return {
    status: 'rejected',
    record,
  }
}

export { STOPPABLE_TURN_STATES }
