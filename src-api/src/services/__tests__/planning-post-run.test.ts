import { describe, expect, it, vi } from 'vitest'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import { createPlanningStreamState } from '../planning-stream-processing'
import { resolvePlanningPostRun } from '../planning-post-run'

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_plan_post',
    taskId: 'task_plan_post',
    runId: 'run_plan_post',
    prompt: 'Plan the task',
    state: 'planning',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function createTransition(turn: TurnRecord, status: TurnTransitionResult['status'] = 'ok', reason?: string): TurnTransitionResult {
  return {
    status,
    turn,
    runtime: null,
    reason,
  }
}

function createPlan(
  overrides: Partial<TaskPlan> = {}
): TaskPlan {
  return {
    id: 'plan_post_run',
    goal: 'Finish the task',
    steps: [
      {
        id: 'step_1',
        description: 'Analyze requirements',
        status: 'pending',
      },
    ],
    createdAt: new Date('2026-03-22T10:00:00.000Z'),
    ...overrides,
  }
}

describe('resolvePlanningPostRun', () => {
  it('creates a fallback plan for placeholder-only planning output and moves turn to awaiting approval', () => {
    const planningTurn = createTurn({ id: 'turn_placeholder' })
    const awaitingTurn = { ...planningTurn, state: 'awaiting_approval' as const }
    const upsertPendingPlan = vi.fn()
    const markTurnAwaitingApproval = vi.fn(() => createTransition(awaitingTurn))
    const planningState = {
      ...createPlanningStreamState(),
      directAnswer: '我会先搜索相关资料并整理方案。',
      sawPlaceholderText: true,
    }

    const result = resolvePlanningPostRun({
      prompt: '帮我梳理 easywork 下一步改造方向',
      planningState,
      runAborted: false,
      activeTurn: planningTurn,
      taskId: 'task_post_run',
      runId: 'run_post_run',
      upsertPendingPlan,
      cancelTurn: vi.fn(),
      completeTurn: vi.fn(),
      markTurnAwaitingApproval,
      createId: (prefix) => `${prefix}_generated`,
      now: new Date('2026-03-22T10:01:00.000Z'),
    })

    expect(result.status).toBe('awaiting_approval')
    expect(result.planningState.planResult).not.toBeNull()
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.type).toBe('plan')
    expect(result.messages[0]?.content).toContain('已生成执行计划')
    expect(upsertPendingPlan).toHaveBeenCalledWith(result.planningState.planResult, {
      taskId: 'task_post_run',
      runId: 'run_post_run',
      turnId: 'turn_placeholder',
    })
    expect(markTurnAwaitingApproval).toHaveBeenCalledWith('turn_placeholder')
    expect(result.turnTransition?.turn?.state).toBe('awaiting_approval')
  })

  it('completes the turn when the planner produced a direct answer without a plan', () => {
    const planningTurn = createTurn({ id: 'turn_direct_answer' })
    const completedTurn = { ...planningTurn, state: 'completed' as const }
    const completeTurn = vi.fn(() => createTransition(completedTurn))
    const planningState = {
      ...createPlanningStreamState(),
      isDirectAnswer: true,
      directAnswer: '建议先稳定单 agent 生命周期，再补强执行产物守卫。',
    }

    const result = resolvePlanningPostRun({
      prompt: '下一步怎么做',
      planningState,
      runAborted: false,
      activeTurn: planningTurn,
      taskId: 'task_post_run',
      runId: 'run_post_run',
      upsertPendingPlan: vi.fn(),
      cancelTurn: vi.fn(),
      completeTurn,
      markTurnAwaitingApproval: vi.fn(),
      createId: (prefix) => `${prefix}_generated`,
      now: new Date('2026-03-22T10:02:00.000Z'),
    })

    expect(result.status).toBe('direct_answer')
    expect(result.messages).toEqual([])
    expect(completeTurn).toHaveBeenCalledWith('turn_direct_answer', '建议先稳定单 agent 生命周期，再补强执行产物守卫。')
    expect(result.turnTransition?.turn?.state).toBe('completed')
  })

  it('cancels the turn when planning was aborted by user', () => {
    const planningTurn = createTurn({ id: 'turn_aborted' })
    const cancelledTurn = { ...planningTurn, state: 'cancelled' as const, reason: 'Planning aborted by user.' }
    const cancelTurn = vi.fn(() => createTransition(cancelledTurn))

    const result = resolvePlanningPostRun({
      prompt: '下一步怎么做',
      planningState: createPlanningStreamState(),
      runAborted: true,
      activeTurn: planningTurn,
      taskId: 'task_post_run',
      runId: 'run_post_run',
      upsertPendingPlan: vi.fn(),
      cancelTurn,
      completeTurn: vi.fn(),
      markTurnAwaitingApproval: vi.fn(),
      createId: (prefix) => `${prefix}_generated`,
      now: new Date('2026-03-22T10:03:00.000Z'),
    })

    expect(result.status).toBe('aborted')
    expect(cancelTurn).toHaveBeenCalledWith('turn_aborted', 'Planning aborted by user.')
    expect(result.turnTransition?.turn?.state).toBe('cancelled')
  })

  it('returns limit_exceeded without synthesizing additional messages', () => {
    const result = resolvePlanningPostRun({
      prompt: '下一步怎么做',
      planningState: {
        ...createPlanningStreamState(),
        clarificationLimitExceeded: true,
      },
      runAborted: false,
      activeTurn: createTurn(),
      taskId: 'task_post_run',
      runId: 'run_post_run',
      upsertPendingPlan: vi.fn(),
      cancelTurn: vi.fn(),
      completeTurn: vi.fn(),
      markTurnAwaitingApproval: vi.fn(),
      createId: (prefix) => `${prefix}_generated`,
      now: new Date('2026-03-22T10:04:00.000Z'),
    })

    expect(result.status).toBe('limit_exceeded')
    expect(result.messages).toEqual([])
    expect(result.turnTransition).toBeNull()
  })
})
