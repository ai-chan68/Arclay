import type { PlanFailReason } from '../types/plan-store'
import type { ApprovalListFilter } from '../types/approval'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'

export type ExecutionTerminalStatus =
  | 'canceled'
  | 'failed'
  | 'waiting_for_user'
  | 'interrupted'
  | 'completed'

export interface FinalizeExecutionLifecycleInput {
  planId: string
  taskId?: string
  runId?: string
  progressPath: string
  executionSummaryText: string
  executionStarted: boolean
  abortedByUser: boolean
  executionFailed: boolean
  executionAwaitingUser: boolean
  executionInterrupted: boolean
  executionFailureReason: string
  activeTurn: TurnRecord | null
  appendProgressEntry: (progressPath: string, lines: string[]) => Promise<void>
  markPlanOrphaned: (
    planId: string,
    reason: string,
    failReason: Exclude<PlanFailReason, null>
  ) => void
  markPlanExecuted: (planId: string) => void
  cancelTurn: (turnId: string, reason?: string) => TurnTransitionResult
  failTurn: (turnId: string, reason?: string) => TurnTransitionResult
  completeTurn: (turnId: string, artifactContent?: string) => TurnTransitionResult
  cancelPendingApprovals?: (
    scope: Omit<ApprovalListFilter, 'status'>,
    reason: string
  ) => number
  orphanPendingApprovals?: (
    scope: Omit<ApprovalListFilter, 'status'>,
    reason: string
  ) => number
  now?: Date
}

export interface FinalizeExecutionLifecycleResult {
  status: ExecutionTerminalStatus | null
  activeTurn: TurnRecord | null
}

function resolveNextActiveTurn(
  currentTurn: TurnRecord | null,
  transition: TurnTransitionResult
): TurnRecord | null {
  return transition.turn || currentTurn
}

function resolveApprovalScope(input: {
  taskId?: string
  runId?: string
  activeTurn: TurnRecord | null
}): Omit<ApprovalListFilter, 'status'> {
  const taskId = input.taskId || input.activeTurn?.taskId || undefined
  const runId = input.runId || input.activeTurn?.runId || undefined
  return {
    taskId,
    runId,
    providerSessionId: runId,
  }
}

function hasApprovalScope(scope: Omit<ApprovalListFilter, 'status'>): boolean {
  return Boolean(scope.taskId || scope.runId || scope.providerSessionId)
}

export async function finalizeExecutionLifecycle(
  input: FinalizeExecutionLifecycleInput
): Promise<FinalizeExecutionLifecycleResult> {
  if (!input.executionStarted) {
    return {
      status: null,
      activeTurn: input.activeTurn,
    }
  }

  const timestamp = (input.now || new Date()).toISOString()
  let activeTurn = input.activeTurn
  const approvalScope = resolveApprovalScope({
    taskId: input.taskId,
    runId: input.runId,
    activeTurn,
  })

  if (input.abortedByUser) {
    input.markPlanOrphaned(input.planId, 'Execution aborted by user.', 'user_cancelled')
    if (input.cancelPendingApprovals && hasApprovalScope(approvalScope)) {
      input.cancelPendingApprovals(approvalScope, 'Execution aborted by user.')
    }
    await input.appendProgressEntry(input.progressPath, [
      `### Execution End (${timestamp})`,
      '- Status: canceled',
      '- Reason: Execution aborted by user.',
    ])
    if (activeTurn) {
      activeTurn = resolveNextActiveTurn(
        activeTurn,
        input.cancelTurn(activeTurn.id, 'Execution aborted by user.')
      )
    }
    return { status: 'canceled', activeTurn }
  }

  if (input.executionFailed) {
    input.markPlanOrphaned(input.planId, input.executionFailureReason, 'execution_error')
    if (input.orphanPendingApprovals && hasApprovalScope(approvalScope)) {
      input.orphanPendingApprovals(approvalScope, input.executionFailureReason)
    }
    await input.appendProgressEntry(input.progressPath, [
      `### Execution End (${timestamp})`,
      '- Status: failed',
      `- Reason: ${input.executionFailureReason}`,
      `- Summary: ${input.executionSummaryText}`,
    ])
    if (activeTurn) {
      activeTurn = resolveNextActiveTurn(
        activeTurn,
        input.failTurn(activeTurn.id, input.executionFailureReason)
      )
    }
    return { status: 'failed', activeTurn }
  }

  if (input.executionAwaitingUser) {
    await input.appendProgressEntry(input.progressPath, [
      `### Execution End (${timestamp})`,
      '- Status: waiting_for_user',
      `- Summary: ${input.executionSummaryText}`,
    ])
    return { status: 'waiting_for_user', activeTurn }
  }

  if (input.executionInterrupted) {
    await input.appendProgressEntry(input.progressPath, [
      `### Execution End (${timestamp})`,
      '- Status: interrupted',
      '- Reason: Execution reached the provider turn limit after making progress.',
      `- Summary: ${input.executionSummaryText}`,
    ])
    return { status: 'interrupted', activeTurn }
  }

  input.markPlanExecuted(input.planId)
  await input.appendProgressEntry(input.progressPath, [
    `### Execution End (${timestamp})`,
    '- Status: completed',
    `- Plan: ${input.planId}`,
    `- Summary: ${input.executionSummaryText}`,
  ])
  if (activeTurn) {
    activeTurn = resolveNextActiveTurn(
      activeTurn,
      input.completeTurn(activeTurn.id, `Execution completed for plan ${input.planId}`)
    )
  }
  return { status: 'completed', activeTurn }
}
