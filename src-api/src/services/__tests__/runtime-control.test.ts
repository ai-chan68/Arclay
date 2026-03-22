import { describe, expect, it, vi } from 'vitest'
import type { AgentRunStopResult } from '../agent-run-store'
import type { PlanRecord } from '../../types/plan-store'
import { rejectPendingPlan, stopAgentSession } from '../runtime-control'

function createPlanRecord(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan_runtime_control',
    taskId: 'task_runtime_control',
    runId: 'run_runtime_control',
    turnId: 'turn_runtime_control',
    status: 'pending_approval',
    failReason: null,
    plan: {
      id: 'plan_runtime_control',
      goal: 'runtime control',
      steps: [],
      createdAt: Date.parse('2026-03-22T16:00:00.000Z'),
    },
    createdAt: Date.parse('2026-03-22T16:00:00.000Z'),
    updatedAt: Date.parse('2026-03-22T16:00:00.000Z'),
    expiresAt: Date.parse('2026-03-23T16:00:00.000Z'),
    executedAt: null,
    reason: null,
    ...overrides,
  }
}

describe('runtime-control', () => {
  it('stops agent session with canonical blocking states and turn cancellation wiring', () => {
    const abortAgentSession = vi.fn(() => false)
    const findLatestTurnByRun = vi.fn(() => ({ id: 'turn_runtime_control' }))
    const cancelTurn = vi.fn()
    const cancelPendingApprovals = vi.fn()
    const stopRun = vi.fn((sessionId: string, options: {
      abortAgentSession?: (sessionId: string) => boolean
      findLatestTurnByRun?: (runId: string) => { id: string } | null
      cancelTurn?: (turnId: string, reason?: string) => void
    }): AgentRunStopResult => {
      expect(sessionId).toBe('run_runtime_control')
      expect(options.abortAgentSession?.('run_runtime_control')).toBe(false)
      expect(abortAgentSession).toHaveBeenCalledWith('run_runtime_control')
      expect(options.findLatestTurnByRun?.('run_runtime_control')).toEqual({ id: 'turn_runtime_control' })
      expect(findLatestTurnByRun).toHaveBeenCalledWith('run_runtime_control', [
        'analyzing',
        'planning',
        'awaiting_approval',
        'awaiting_clarification',
        'executing',
        'blocked',
        'queued',
      ])
      options.cancelTurn?.('turn_runtime_control', 'Session stopped by user.')
      return {
        status: 'stopped',
        source: 'active_run',
        turnId: 'turn_runtime_control',
      }
    })

    const result = stopAgentSession({
      sessionId: 'run_runtime_control',
      stopRun,
      abortAgentSession,
      findLatestTurnByRun,
      cancelTurn,
      cancelPendingApprovals,
    })

    expect(result).toEqual({
      status: 'stopped',
      source: 'active_run',
      turnId: 'turn_runtime_control',
    })
    expect(cancelTurn).toHaveBeenCalledWith('turn_runtime_control', 'Session stopped by user.')
    expect(cancelPendingApprovals).toHaveBeenCalledWith({
      runId: 'run_runtime_control',
      providerSessionId: 'run_runtime_control',
    }, 'Session stopped by user.')
  })

  it('rejects pending plan and cancels the bound turn with explicit reason', () => {
    const cancelTurn = vi.fn()
    const cancelPendingApprovals = vi.fn()
    const markRejected = vi.fn(() => createPlanRecord({
      status: 'rejected',
      failReason: 'approval_rejected',
      reason: 'Rejected from test',
    }))

    const result = rejectPendingPlan({
      planId: 'plan_runtime_control',
      reason: 'Rejected from test',
      markRejected,
      cancelTurn,
      cancelPendingApprovals,
    })

    expect(markRejected).toHaveBeenCalledWith('plan_runtime_control', 'Rejected from test')
    expect(cancelTurn).toHaveBeenCalledWith('turn_runtime_control', 'Rejected from test')
    expect(cancelPendingApprovals).toHaveBeenCalledWith({
      taskId: 'task_runtime_control',
      runId: 'run_runtime_control',
      providerSessionId: 'run_runtime_control',
    }, 'Rejected from test')
    expect(result).toEqual({
      status: 'rejected',
      record: expect.objectContaining({
        id: 'plan_runtime_control',
        status: 'rejected',
      }),
    })
  })

  it('returns not_found when rejecting a missing plan and does not cancel turns', () => {
    const cancelTurn = vi.fn()
    const cancelPendingApprovals = vi.fn()
    const markRejected = vi.fn(() => null)

    const result = rejectPendingPlan({
      planId: 'missing_plan',
      reason: undefined,
      markRejected,
      cancelTurn,
      cancelPendingApprovals,
    })

    expect(result).toEqual({ status: 'not_found' })
    expect(cancelTurn).not.toHaveBeenCalled()
    expect(cancelPendingApprovals).not.toHaveBeenCalled()
  })
})
