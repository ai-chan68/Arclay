import type { ApprovalListFilter } from '../types/approval'
import { turnRuntimeStore } from './turn-runtime-store'

type ExpiredPlanTurnRecord = {
  turnId?: string | null
  reason?: string | null
  taskId?: string | null
  runId?: string | null
}

function hasApprovalScope(scope: Omit<ApprovalListFilter, 'status'>): boolean {
  return Boolean(scope.taskId || scope.runId || scope.providerSessionId)
}

export function cancelTurnsForExpiredPlans(
  records: ExpiredPlanTurnRecord[],
  options: {
    cancelPendingApprovals?: (
      scope: Omit<ApprovalListFilter, 'status'>,
      reason: string
    ) => number
  } = {}
): number {
  let count = 0

  for (const record of records) {
    if (!record.turnId) continue
    const reason = record.reason || 'Plan expired before approval.'
    const result = turnRuntimeStore.cancelTurn(
      record.turnId,
      reason
    )
    if (result.status === 'ok') {
      const approvalScope: Omit<ApprovalListFilter, 'status'> = {
        taskId: record.taskId || undefined,
        runId: record.runId || undefined,
        providerSessionId: record.runId || undefined,
      }
      if (options.cancelPendingApprovals && hasApprovalScope(approvalScope)) {
        options.cancelPendingApprovals(approvalScope, reason)
      }
      count += 1
    }
  }

  return count
}
