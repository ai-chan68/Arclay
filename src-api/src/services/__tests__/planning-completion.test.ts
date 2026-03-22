import { describe, expect, it, vi } from 'vitest'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import { resolvePlanningCompletion } from '../planning-completion'

function createTurn(id = 'turn_plan_completion'): TurnRecord {
  return {
    id,
    taskId: 'task_plan_completion',
    runId: 'run_plan_completion',
    prompt: 'Plan the task',
    state: 'planning',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function createPlan(): TaskPlan {
  return {
    id: 'plan_completion',
    goal: 'Complete the task',
    steps: [
      { id: 'step_1', description: 'Do the work', status: 'pending' },
    ],
    createdAt: new Date('2026-03-21T00:00:00.000Z'),
  }
}

function okResult(turn: TurnRecord): TurnTransitionResult {
  return {
    status: 'ok',
    turn,
    runtime: null,
  }
}

describe('resolvePlanningCompletion', () => {
  it('cancels the active turn when planning is aborted', () => {
    const activeTurn = createTurn('turn_plan_aborted')
    const cancelTurn = vi.fn(() =>
      okResult({ ...activeTurn, state: 'cancelled', reason: 'Planning aborted by user.' })
    )

    const result = resolvePlanningCompletion({
      runAborted: true,
      clarificationLimitExceeded: false,
      isDirectAnswer: false,
      directAnswer: '',
      planResult: null,
      activeTurn,
      cancelTurn,
      completeTurn: vi.fn(),
      markTurnAwaitingApproval: vi.fn(),
    })

    expect(result.status).toBe('aborted')
    expect(cancelTurn).toHaveBeenCalledWith('turn_plan_aborted', 'Planning aborted by user.')
    expect(result.turnTransition?.turn?.state).toBe('cancelled')
    expect(result.activeTurn?.state).toBe('cancelled')
  })

  it('returns direct_answer and completes the turn when no plan is produced', () => {
    const activeTurn = createTurn('turn_plan_direct_answer')
    const completeTurn = vi.fn(() =>
      okResult({ ...activeTurn, state: 'completed', reason: 'direct answer' })
    )

    const result = resolvePlanningCompletion({
      runAborted: false,
      clarificationLimitExceeded: false,
      isDirectAnswer: true,
      directAnswer: 'Here is the direct answer',
      planResult: null,
      activeTurn,
      cancelTurn: vi.fn(),
      completeTurn,
      markTurnAwaitingApproval: vi.fn(),
    })

    expect(result.status).toBe('direct_answer')
    expect(completeTurn).toHaveBeenCalledWith('turn_plan_direct_answer', 'Here is the direct answer')
    expect(result.turnTransition?.turn?.state).toBe('completed')
    expect(result.activeTurn?.state).toBe('completed')
  })

  it('marks the active turn awaiting approval when a plan is ready', () => {
    const activeTurn = createTurn('turn_plan_approval')
    const markTurnAwaitingApproval = vi.fn(() =>
      okResult({ ...activeTurn, state: 'awaiting_approval' })
    )

    const result = resolvePlanningCompletion({
      runAborted: false,
      clarificationLimitExceeded: false,
      isDirectAnswer: false,
      directAnswer: '',
      planResult: createPlan(),
      activeTurn,
      cancelTurn: vi.fn(),
      completeTurn: vi.fn(),
      markTurnAwaitingApproval,
    })

    expect(result.status).toBe('awaiting_approval')
    expect(markTurnAwaitingApproval).toHaveBeenCalledWith('turn_plan_approval')
    expect(result.turnTransition?.turn?.state).toBe('awaiting_approval')
    expect(result.activeTurn?.state).toBe('awaiting_approval')
  })

  it('returns limit_exceeded or done without mutating turn state when no transition is needed', () => {
    const activeTurn = createTurn('turn_plan_noop')

    const limitExceeded = resolvePlanningCompletion({
      runAborted: false,
      clarificationLimitExceeded: true,
      isDirectAnswer: false,
      directAnswer: '',
      planResult: null,
      activeTurn,
      cancelTurn: vi.fn(),
      completeTurn: vi.fn(),
      markTurnAwaitingApproval: vi.fn(),
    })

    const done = resolvePlanningCompletion({
      runAborted: false,
      clarificationLimitExceeded: false,
      isDirectAnswer: false,
      directAnswer: '',
      planResult: null,
      activeTurn,
      cancelTurn: vi.fn(),
      completeTurn: vi.fn(),
      markTurnAwaitingApproval: vi.fn(),
    })

    expect(limitExceeded.status).toBe('limit_exceeded')
    expect(limitExceeded.turnTransition).toBeNull()
    expect(limitExceeded.activeTurn).toEqual(activeTurn)
    expect(done.status).toBe('done')
    expect(done.turnTransition).toBeNull()
    expect(done.activeTurn).toEqual(activeTurn)
  })
})
