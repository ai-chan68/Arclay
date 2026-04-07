import { describe, expect, it, vi } from 'vitest'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import { resolveExecutionPause } from '../execution-pause'

function createTurn(id = 'turn_pause'): TurnRecord {
  return {
    id,
    taskId: 'task_pause',
    runId: 'run_pause',
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

describe('resolveExecutionPause', () => {
  it('creates a synthetic clarification request when blocker exists without pending interactions', async () => {
    const activeTurn = createTurn('turn_blocker')
    const appendProgressEntry = vi.fn(async () => {})
    const captureQuestionRequest = vi.fn()
    const markTurnAwaitingClarification = vi.fn(() =>
      okResult({ ...activeTurn, state: 'awaiting_clarification' })
    )
    const createId = vi
      .fn<(prefix: string) => string>()
      .mockImplementationOnce(() => 'question_blocker_1')
      .mockImplementationOnce(() => 'msg_blocker_1')

    const result = await resolveExecutionPause({
      executionTaskId: 'task_blocker',
      runId: 'run_blocker',
      progressPath: '/tmp/progress.md',
      pendingInteractionCount: 0,
      blockerCandidate: {
        reason: '需要先完成登录',
        userMessage: '执行被阻塞：请先完成登录后回复我继续。',
      },
      activeTurn,
      appendProgressEntry,
      captureQuestionRequest,
      recountPendingInteractions: () => 1,
      markTurnAwaitingClarification,
      createId,
      now: new Date('2026-03-21T12:05:00.000Z'),
    })

    expect(result.shouldPause).toBe(true)
    expect(result.pendingInteractionCount).toBe(1)
    expect(captureQuestionRequest).toHaveBeenCalledWith(
      {
        id: 'question_blocker_1',
        question: '执行被阻塞：请先完成登录后回复我继续。',
        options: ['已处理，请继续', '需要我补充信息'],
        allowFreeText: true,
        source: 'runtime_tool_question',
      },
      {
        taskId: 'task_blocker',
        runId: 'run_blocker',
        providerSessionId: 'run_blocker',
        source: 'runtime_tool_question',
      }
    )
    expect(result.clarificationMessage?.type).toBe('clarification_request')
    expect(result.clarificationMessage?.content).toBe('执行被阻塞：请先完成登录后回复我继续。')
    expect(markTurnAwaitingClarification).toHaveBeenCalledWith('turn_blocker')
    expect(result.activeTurn?.state).toBe('awaiting_clarification')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution Pause (2026-03-21T12:05:00.000Z)',
      '- Status: waiting_for_user',
      '- Reason: 需要先完成登录',
      '- User Action Required: 执行被阻塞：请先完成登录后回复我继续。',
    ])
  })

  it('reuses existing pending interactions without creating another clarification request', async () => {
    const activeTurn = createTurn('turn_pending')
    const appendProgressEntry = vi.fn(async () => {})
    const captureQuestionRequest = vi.fn()
    const markTurnAwaitingClarification = vi.fn(() =>
      okResult({ ...activeTurn, state: 'awaiting_clarification' })
    )

    const result = await resolveExecutionPause({
      executionTaskId: 'task_pending',
      runId: 'run_pending',
      progressPath: '/tmp/progress.md',
      pendingInteractionCount: 2,
      blockerCandidate: null,
      activeTurn,
      appendProgressEntry,
      captureQuestionRequest,
      recountPendingInteractions: () => 2,
      markTurnAwaitingClarification,
      createId: () => {
        throw new Error('should not create ids when no synthetic clarification is needed')
      },
      now: new Date('2026-03-21T12:06:00.000Z'),
    })

    expect(result.shouldPause).toBe(true)
    expect(result.pendingInteractionCount).toBe(2)
    expect(result.clarificationMessage).toBeNull()
    expect(captureQuestionRequest).not.toHaveBeenCalled()
    expect(markTurnAwaitingClarification).toHaveBeenCalledWith('turn_pending')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Execution Pause (2026-03-21T12:06:00.000Z)',
      '- Status: waiting_for_user',
      '- Reason: Execution is waiting for user input.',
      '- User Action Required: 执行需要你的输入后才能继续，请处理后回复我继续。',
    ])
  })

  it('does nothing when execution has no pending interactions and no blocker candidate', async () => {
    const activeTurn = createTurn('turn_continue')
    const appendProgressEntry = vi.fn(async () => {})
    const captureQuestionRequest = vi.fn()
    const markTurnAwaitingClarification = vi.fn()

    const result = await resolveExecutionPause({
      executionTaskId: 'task_continue',
      runId: 'run_continue',
      progressPath: '/tmp/progress.md',
      pendingInteractionCount: 0,
      blockerCandidate: null,
      activeTurn,
      appendProgressEntry,
      captureQuestionRequest,
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification,
      createId: () => 'unused',
      now: new Date('2026-03-21T12:07:00.000Z'),
    })

    expect(result.shouldPause).toBe(false)
    expect(result.pendingInteractionCount).toBe(0)
    expect(result.activeTurn).toEqual(activeTurn)
    expect(result.clarificationMessage).toBeNull()
    expect(captureQuestionRequest).not.toHaveBeenCalled()
    expect(markTurnAwaitingClarification).not.toHaveBeenCalled()
    expect(appendProgressEntry).not.toHaveBeenCalled()
  })
})
