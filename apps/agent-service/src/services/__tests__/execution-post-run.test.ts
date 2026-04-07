import { describe, expect, it, vi } from 'vitest'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import type { ExecutionCompletionSummary } from '../execution-completion'
import { resolveExecutionPostRun } from '../execution-post-run'

function createTurn(id = 'turn_post_run'): TurnRecord {
  return {
    id,
    taskId: 'task_post_run',
    runId: 'run_post_run',
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

function createPlan(): TaskPlan {
  return {
    id: 'plan_post_run',
    goal: 'Open the page and return the order number',
    steps: [
      { id: 'step_1', description: 'Open the page', status: 'pending' },
      { id: 'step_2', description: 'Return the order number', status: 'pending' },
    ],
    createdAt: new Date('2026-03-21T00:00:00.000Z'),
  }
}

function createSummary(
  overrides: Partial<ExecutionCompletionSummary> = {}
): ExecutionCompletionSummary {
  return {
    toolUseCount: 0,
    toolResultCount: 0,
    meaningfulToolUseCount: 0,
    browserToolUseCount: 0,
    browserNavigationCount: 0,
    browserInteractionCount: 0,
    browserSnapshotCount: 0,
    browserScreenshotCount: 0,
    browserEvalCount: 0,
    assistantTextCount: 0,
    meaningfulAssistantTextCount: 0,
    preambleAssistantTextCount: 0,
    resultMessageCount: 0,
    latestTodoSnapshot: null,
    pendingInteractionCount: 0,
    blockerCandidate: null,
    blockedArtifactPath: null,
    providerResultSubtype: null,
    providerStopReason: null,
    ...overrides,
  }
}

function okResult(turn: TurnRecord): TurnTransitionResult {
  return {
    status: 'ok',
    turn,
    runtime: null,
  }
}

describe('resolveExecutionPostRun', () => {
  it('pauses for user input and returns clarification emission payload', async () => {
    const activeTurn = createTurn('turn_pause_needed')
    const summary = createSummary({
      blockerCandidate: {
        reason: '需要先完成登录',
        userMessage: '执行被阻塞：请先完成登录后回复我继续。',
      },
    })
    const appendProgressEntry = vi.fn(async () => {})
    const captureQuestionRequest = vi.fn()
    const markTurnAwaitingClarification = vi.fn(() =>
      okResult({ ...activeTurn, state: 'awaiting_clarification' })
    )
    const recountPendingInteractions = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
    const createId = vi
      .fn<(prefix: string) => string>()
      .mockImplementationOnce(() => 'question_pause_1')
      .mockImplementationOnce(() => 'msg_pause_1')

    const result = await resolveExecutionPostRun({
      executionTaskId: 'task_pause_needed',
      runId: 'run_pause_needed',
      progressPath: '/tmp/progress.md',
      executionSummary: summary,
      promptText: 'Open the page and return the order number',
      plan: createPlan(),
      activeTurn,
      appendProgressEntry,
      captureQuestionRequest,
      recountPendingInteractions,
      markTurnAwaitingClarification,
      createId,
    })

    expect(result.status).toBe('waiting_for_user')
    expect(result.executionAwaitingUser).toBe(true)
    expect(result.executionFailed).toBe(false)
    expect(result.executionInterrupted).toBe(false)
    expect(result.pendingInteractionCount).toBe(1)
    expect(result.messages.map((message) => message.type)).toEqual(['clarification_request'])
    expect(result.turnTransition?.turn?.state).toBe('awaiting_clarification')
    expect(result.activeTurn?.state).toBe('awaiting_clarification')
    expect(captureQuestionRequest).toHaveBeenCalledTimes(1)
    expect(appendProgressEntry).toHaveBeenCalledTimes(1)
  })

  it('returns interrupted when provider hits max turns after meaningful progress', async () => {
    const summary = createSummary({
      meaningfulToolUseCount: 1,
      resultMessageCount: 1,
      providerResultSubtype: 'max_turns',
      latestTodoSnapshot: {
        total: 2,
        completed: 1,
        inProgress: 1,
        pending: 0,
        failed: 0,
        currentItems: ['Extract the order number'],
      },
    })

    const result = await resolveExecutionPostRun({
      executionTaskId: 'task_interrupted',
      runId: 'run_interrupted',
      progressPath: '/tmp/progress.md',
      executionSummary: summary,
      promptText: 'Use Playwright to query the order and summarize the visible status information',
      plan: createPlan(),
      activeTurn: createTurn('turn_interrupted'),
      appendProgressEntry: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      createId: () => 'msg_interrupted_1',
    })

    expect(result.status).toBe('interrupted')
    expect(result.executionAwaitingUser).toBe(false)
    expect(result.executionInterrupted).toBe(true)
    expect(result.executionFailed).toBe(false)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.type).toBe('result')
    expect(result.messages[0]?.content).toContain('执行达到轮次上限')
  })

  it('returns failed with an error message when execution is incomplete', async () => {
    const summary = createSummary({
      toolUseCount: 1,
      meaningfulToolUseCount: 1,
      resultMessageCount: 0,
      latestTodoSnapshot: {
        total: 2,
        completed: 2,
        inProgress: 0,
        pending: 0,
        failed: 0,
        currentItems: [],
      },
    })

    const result = await resolveExecutionPostRun({
      executionTaskId: 'task_incomplete',
      runId: 'run_incomplete',
      progressPath: '/tmp/progress.md',
      executionSummary: summary,
      promptText: '打开订单查询页面并获取OMS统一订单号',
      plan: createPlan(),
      activeTurn: createTurn('turn_incomplete'),
      appendProgressEntry: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      createId: () => 'msg_incomplete_1',
    })

    expect(result.status).toBe('failed')
    expect(result.executionAwaitingUser).toBe(false)
    expect(result.executionInterrupted).toBe(false)
    expect(result.executionFailed).toBe(true)
    expect(result.executionFailureReason).toContain('final user-visible result')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.type).toBe('error')
    expect(String(result.messages[0]?.errorMessage || '')).toContain('final user-visible result')
  })

  it('returns completed without extra messages when no pause or failure is needed', async () => {
    const summary = createSummary({
      meaningfulToolUseCount: 1,
      resultMessageCount: 1,
      latestTodoSnapshot: {
        total: 1,
        completed: 1,
        inProgress: 0,
        pending: 0,
        failed: 0,
        currentItems: [],
      },
    })
    const activeTurn = createTurn('turn_completed_clean')

    const result = await resolveExecutionPostRun({
      executionTaskId: 'task_completed_clean',
      runId: 'run_completed_clean',
      progressPath: '/tmp/progress.md',
      executionSummary: summary,
      promptText: '执行计划并返回结果',
      plan: createPlan(),
      activeTurn,
      appendProgressEntry: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      createId: () => 'unused',
    })

    expect(result.status).toBe('completed')
    expect(result.executionAwaitingUser).toBe(false)
    expect(result.executionInterrupted).toBe(false)
    expect(result.executionFailed).toBe(false)
    expect(result.executionFailureReason).toBe('')
    expect(result.messages).toEqual([])
    expect(result.turnTransition).toBeNull()
    expect(result.activeTurn).toEqual(activeTurn)
  })
})
