type PlanSweepRecord = {
  id: string
  turnId?: string | null
  taskId?: string | null
  runId?: string | null
}

interface ApprovalCoordinatorRecovery {
  markAllPendingAsOrphanedOnStartup: () => number
  startLifecycleSweep: () => void
}

interface PlanStoreRecovery {
  sweepOnStartup: () => {
    orphanedCount: number
    expiredCount: number
    expiredRecords: PlanSweepRecord[]
    compactedCount: number
  }
  startLifecycleSweep: (
    intervalMs: number,
    onExpired: (records: PlanSweepRecord[]) => void
  ) => void
}

interface TurnRuntimeStoreRecovery {
  sweepOnStartup: () => {
    resetRuntimeCount: number
    interruptedTurnCount: number
  }
}

export interface BootstrapRuntimeRecoveryInput {
  approvalCoordinator: ApprovalCoordinatorRecovery
  planStore: PlanStoreRecovery
  turnRuntimeStore: TurnRuntimeStoreRecovery
  cancelExpiredPlanTurns: (records: PlanSweepRecord[]) => number
  logInfo: (message: string, ...args: unknown[]) => void
}

export function bootstrapRuntimeRecovery(
  input: BootstrapRuntimeRecoveryInput
): void {
  const orphanedCount = input.approvalCoordinator.markAllPendingAsOrphanedOnStartup()
  if (orphanedCount > 0) {
    input.logInfo(`[API] Marked pending approvals as orphaned on startup: ${orphanedCount}`)
  }
  input.approvalCoordinator.startLifecycleSweep()

  const planSweep = input.planStore.sweepOnStartup()
  if (planSweep.expiredRecords.length > 0) {
    input.cancelExpiredPlanTurns(planSweep.expiredRecords)
  }
  if (planSweep.orphanedCount > 0 || planSweep.expiredCount > 0 || planSweep.compactedCount > 0) {
    input.logInfo('[API] Plan store sweep on startup:', planSweep)
  }
  input.planStore.startLifecycleSweep(60_000, (records) => {
    const cancelledTurnCount = input.cancelExpiredPlanTurns(records)
    if (cancelledTurnCount > 0) {
      input.logInfo('[API] Cancelled turns for expired plans:', cancelledTurnCount)
    }
  })

  const turnRuntimeSweep = input.turnRuntimeStore.sweepOnStartup()
  if (turnRuntimeSweep.resetRuntimeCount > 0 || turnRuntimeSweep.interruptedTurnCount > 0) {
    input.logInfo('[API] Turn runtime sweep on startup:', turnRuntimeSweep)
  }
}
