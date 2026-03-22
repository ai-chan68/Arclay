import { describe, expect, it, vi } from 'vitest'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import { finalizeExecutionLifecycle } from '../execution-lifecycle'
import { appendProgressEntry } from '../route-support'

function createTurn(id = 'turn_exec_lifecycle'): TurnRecord {
  return {
    id,
    taskId: 'task_exec_lifecycle',
    runId: 'run_exec_lifecycle',
    prompt: 'Execute the plan',
    state: 'executing',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function okResult(turn: TurnRecord): TurnTransitionResult {
  return {
    status: 'ok',
    turn,
    runtime: null,
  }
}

describe('finalizeExecutionLifecycle', () => {
  it('orphans the plan, appends canceled progress, and cancels the active turn for user aborts', async () => {
    const activeTurn = createTurn('turn_aborted')
    const appendProgressEntry = vi.fn(async () => {})
    const markPlanOrphaned = vi.fn()
    const cancelTurn = vi.fn(() => okResult({ ...activeTurn, state: 'cancelled', reason: 'Execution aborted by user.' }))
    const cancelPendingApprovals = vi.fn()

    const result = await finalizeExecutionLifecycle({
      planId: 'plan_aborted',
      taskId: activeTurn.taskId,
      runId: activeTurn.runId || undefined,
      progressPath: '/tmp/progress.md',
      executionSummaryText: 'summary=aborted',
      executionStarted: true,
      abortedByUser: true,
      executionFailed: false,
      executionAwaitingUser: false,
      executionInterrupted: false,
      executionFailureReason: 'ignored',
      activeTurn,
      appendProgressEntry,
      markPlanOrphaned,
      markPlanExecuted: vi.fn(),
      cancelTurn,
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      cancelPendingApprovals,
      now: new Date('2026-03-21T12:00:00.000Z'),
    })

    expect(result.status).toBe('canceled')
    expect(markPlanOrphaned).toHaveBeenCalledWith('plan_aborted', 'Execution aborted by user.', 'user_cancelled')
    expect(cancelTurn).toHaveBeenCalledWith('turn_aborted', 'Execution aborted by user.')
    expect(cancelPendingApprovals).toHaveBeenCalledWith({
      taskId: 'task_exec_lifecycle',
      runId: 'run_exec_lifecycle',
      providerSessionId: 'run_exec_lifecycle',
    }, 'Execution aborted by user.')
    expect(result.activeTurn?.state).toBe('cancelled')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution End (2026-03-21T12:00:00.000Z)',
      '- Status: canceled',
      '- Reason: Execution aborted by user.',
    ])
  })

  it('orphans the plan, appends failed progress, and fails the active turn on execution failure', async () => {
    const activeTurn = createTurn('turn_failed')
    const appendProgressEntry = vi.fn(async () => {})
    const markPlanOrphaned = vi.fn()
    const failTurn = vi.fn(() => okResult({ ...activeTurn, state: 'failed', reason: 'Execution failed.' }))
    const orphanPendingApprovals = vi.fn()

    const result = await finalizeExecutionLifecycle({
      planId: 'plan_failed',
      taskId: activeTurn.taskId,
      runId: activeTurn.runId || undefined,
      progressPath: '/tmp/progress.md',
      executionSummaryText: 'summary=failed',
      executionStarted: true,
      abortedByUser: false,
      executionFailed: true,
      executionAwaitingUser: false,
      executionInterrupted: false,
      executionFailureReason: 'Execution failed.',
      activeTurn,
      appendProgressEntry,
      markPlanOrphaned,
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn,
      completeTurn: vi.fn(),
      orphanPendingApprovals,
      now: new Date('2026-03-21T12:01:00.000Z'),
    })

    expect(result.status).toBe('failed')
    expect(markPlanOrphaned).toHaveBeenCalledWith('plan_failed', 'Execution failed.', 'execution_error')
    expect(failTurn).toHaveBeenCalledWith('turn_failed', 'Execution failed.')
    expect(orphanPendingApprovals).toHaveBeenCalledWith({
      taskId: 'task_exec_lifecycle',
      runId: 'run_exec_lifecycle',
      providerSessionId: 'run_exec_lifecycle',
    }, 'Execution failed.')
    expect(result.activeTurn?.state).toBe('failed')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution End (2026-03-21T12:01:00.000Z)',
      '- Status: failed',
      '- Reason: Execution failed.',
      '- Summary: summary=failed',
    ])
  })

  it('keeps the plan executing and records waiting_for_user without mutating the turn terminal state', async () => {
    const activeTurn = createTurn('turn_waiting')
    const appendProgressEntry = vi.fn(async () => {})

    const result = await finalizeExecutionLifecycle({
      planId: 'plan_waiting',
      progressPath: '/tmp/progress.md',
      executionSummaryText: 'summary=waiting',
      executionStarted: true,
      abortedByUser: false,
      executionFailed: false,
      executionAwaitingUser: true,
      executionInterrupted: false,
      executionFailureReason: 'ignored',
      activeTurn,
      appendProgressEntry,
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      now: new Date('2026-03-21T12:02:00.000Z'),
    })

    expect(result.status).toBe('waiting_for_user')
    expect(result.activeTurn).toEqual(activeTurn)
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution End (2026-03-21T12:02:00.000Z)',
      '- Status: waiting_for_user',
      '- Summary: summary=waiting',
    ])
  })

  it('records interrupted completion without changing plan terminal status', async () => {
    const activeTurn = createTurn('turn_interrupted')
    const appendProgressEntry = vi.fn(async () => {})
    const markPlanExecuted = vi.fn()

    const result = await finalizeExecutionLifecycle({
      planId: 'plan_interrupted',
      progressPath: '/tmp/progress.md',
      executionSummaryText: 'summary=interrupted',
      executionStarted: true,
      abortedByUser: false,
      executionFailed: false,
      executionAwaitingUser: false,
      executionInterrupted: true,
      executionFailureReason: 'ignored',
      activeTurn,
      appendProgressEntry,
      markPlanOrphaned: vi.fn(),
      markPlanExecuted,
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      now: new Date('2026-03-21T12:03:00.000Z'),
    })

    expect(result.status).toBe('interrupted')
    expect(markPlanExecuted).not.toHaveBeenCalled()
    expect(result.activeTurn).toEqual(activeTurn)
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution End (2026-03-21T12:03:00.000Z)',
      '- Status: interrupted',
      '- Reason: Execution reached the provider turn limit after making progress.',
      '- Summary: summary=interrupted',
    ])
  })

  it('marks the plan executed, appends completed progress, and completes the turn on success', async () => {
    const activeTurn = createTurn('turn_completed')
    const appendProgressEntry = vi.fn(async () => {})
    const markPlanExecuted = vi.fn()
    const completeTurn = vi.fn(() => okResult({
      ...activeTurn,
      state: 'completed',
      writeVersion: 1,
    }))

    const result = await finalizeExecutionLifecycle({
      planId: 'plan_completed',
      progressPath: '/tmp/progress.md',
      executionSummaryText: 'summary=completed',
      executionStarted: true,
      abortedByUser: false,
      executionFailed: false,
      executionAwaitingUser: false,
      executionInterrupted: false,
      executionFailureReason: 'ignored',
      activeTurn,
      appendProgressEntry,
      markPlanOrphaned: vi.fn(),
      markPlanExecuted,
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn,
      now: new Date('2026-03-21T12:04:00.000Z'),
    })

    expect(result.status).toBe('completed')
    expect(markPlanExecuted).toHaveBeenCalledWith('plan_completed')
    expect(completeTurn).toHaveBeenCalledWith('turn_completed', 'Execution completed for plan plan_completed')
    expect(result.activeTurn?.state).toBe('completed')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution End (2026-03-21T12:04:00.000Z)',
      '- Status: completed',
      '- Plan: plan_completed',
      '- Summary: summary=completed',
    ])
  })

  it('preserves failure evidence by recreating execution artifacts when progress workspace is missing', async () => {
    const { mkdtemp, readFile, rm } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')

    const sessionDir = await mkdtemp(join(tmpdir(), 'exec-lifecycle-artifacts-'))
    const progressPath = join(sessionDir, 'progress.md')
    await rm(sessionDir, { recursive: true, force: true })

    const activeTurn = createTurn('turn_failed_artifacts')

    const result = await finalizeExecutionLifecycle({
      planId: 'plan_failed_artifacts',
      taskId: activeTurn.taskId,
      runId: activeTurn.runId || undefined,
      progressPath,
      executionSummaryText: 'summary=failed_artifacts',
      executionStarted: true,
      abortedByUser: false,
      executionFailed: true,
      executionAwaitingUser: false,
      executionInterrupted: false,
      executionFailureReason: 'Execution failed after workspace loss.',
      activeTurn,
      appendProgressEntry,
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(() => okResult({
        ...activeTurn,
        state: 'failed',
        reason: 'Execution failed after workspace loss.',
      })),
      completeTurn: vi.fn(),
      now: new Date('2026-03-21T12:05:00.000Z'),
    })

    expect(result.status).toBe('failed')

    const progressContent = await readFile(progressPath, 'utf-8')
    expect(progressContent).toContain('# Progress Log')
    expect(progressContent).toContain('### Execution End (2026-03-21T12:05:00.000Z)')
    expect(progressContent).toContain('Execution failed after workspace loss.')

    await rm(sessionDir, { recursive: true, force: true })
  })
})
