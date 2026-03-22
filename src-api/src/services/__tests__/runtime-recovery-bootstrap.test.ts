import { describe, expect, it, vi } from 'vitest'
import { bootstrapRuntimeRecovery } from '../runtime-recovery-bootstrap'

describe('bootstrapRuntimeRecovery', () => {
  it('runs startup recovery in order and wires later expired-plan callbacks', () => {
    const approvalSweep = vi.fn()
    const approvalOrphan = vi.fn(() => 2)
    const cancelExpiredPlanTurns = vi.fn(() => 1)
    const planLifecycleSweep = vi.fn()
    const planSweepOnStartup = vi.fn(() => ({
      orphanedCount: 1,
      expiredCount: 2,
      expiredRecords: [
        { id: 'plan_expired_1', turnId: 'turn_1' },
        { id: 'plan_expired_2', turnId: 'turn_2' },
      ],
      compactedCount: 3,
    }))
    const turnRuntimeSweepOnStartup = vi.fn(() => ({
      resetRuntimeCount: 1,
      interruptedTurnCount: 2,
    }))
    const logInfo = vi.fn()

    bootstrapRuntimeRecovery({
      approvalCoordinator: {
        markAllPendingAsOrphanedOnStartup: approvalOrphan,
        startLifecycleSweep: approvalSweep,
      },
      planStore: {
        sweepOnStartup: planSweepOnStartup,
        startLifecycleSweep: planLifecycleSweep,
      },
      turnRuntimeStore: {
        sweepOnStartup: turnRuntimeSweepOnStartup,
      },
      cancelExpiredPlanTurns,
      logInfo,
    })

    expect(approvalOrphan).toHaveBeenCalledTimes(1)
    expect(approvalSweep).toHaveBeenCalledTimes(1)
    expect(planSweepOnStartup).toHaveBeenCalledTimes(1)
    expect(cancelExpiredPlanTurns).toHaveBeenNthCalledWith(1, [
      { id: 'plan_expired_1', turnId: 'turn_1' },
      { id: 'plan_expired_2', turnId: 'turn_2' },
    ])
    expect(planLifecycleSweep).toHaveBeenCalledTimes(1)
    expect(planLifecycleSweep.mock.calls[0]?.[0]).toBe(60_000)
    expect(typeof planLifecycleSweep.mock.calls[0]?.[1]).toBe('function')
    expect(turnRuntimeSweepOnStartup).toHaveBeenCalledTimes(1)
    expect(logInfo).toHaveBeenCalledWith('[API] Marked pending approvals as orphaned on startup: 2')
    expect(logInfo).toHaveBeenCalledWith('[API] Plan store sweep on startup:', {
      orphanedCount: 1,
      expiredCount: 2,
      expiredRecords: [
        { id: 'plan_expired_1', turnId: 'turn_1' },
        { id: 'plan_expired_2', turnId: 'turn_2' },
      ],
      compactedCount: 3,
    })
    expect(logInfo).toHaveBeenCalledWith('[API] Turn runtime sweep on startup:', {
      resetRuntimeCount: 1,
      interruptedTurnCount: 2,
    })

    const onExpired = planLifecycleSweep.mock.calls[0]?.[1] as (records: Array<{ id: string }>) => void
    onExpired([{ id: 'plan_expired_3', turnId: 'turn_3' }])
    expect(cancelExpiredPlanTurns).toHaveBeenNthCalledWith(2, [{ id: 'plan_expired_3', turnId: 'turn_3' }])
    expect(logInfo).toHaveBeenCalledWith('[API] Cancelled turns for expired plans:', 1)
  })

  it('avoids noisy logs when startup recovery finds nothing to reconcile', () => {
    const logInfo = vi.fn()
    const planLifecycleSweep = vi.fn()

    bootstrapRuntimeRecovery({
      approvalCoordinator: {
        markAllPendingAsOrphanedOnStartup: () => 0,
        startLifecycleSweep: vi.fn(),
      },
      planStore: {
        sweepOnStartup: () => ({
          orphanedCount: 0,
          expiredCount: 0,
          expiredRecords: [],
          compactedCount: 0,
        }),
        startLifecycleSweep: planLifecycleSweep,
      },
      turnRuntimeStore: {
        sweepOnStartup: () => ({
          resetRuntimeCount: 0,
          interruptedTurnCount: 0,
        }),
      },
      cancelExpiredPlanTurns: vi.fn(() => 0),
      logInfo,
    })

    expect(logInfo).not.toHaveBeenCalled()
    expect(planLifecycleSweep).toHaveBeenCalledTimes(1)
  })
})
