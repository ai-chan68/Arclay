import { describe, expect, it, vi } from 'vitest'
import type { PendingQuestion } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import {
  advancePlanningTurn,
  handleBlockedClarificationLimit,
  handlePreflightClarification,
} from '../planning-lifecycle'

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_plan',
    taskId: 'task_plan',
    runId: 'run_plan',
    prompt: 'Plan the task',
    state: 'queued',
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

describe('advancePlanningTurn', () => {
  it('moves queued turns through analyzing into planning', () => {
    const queuedTurn = createTurn({ state: 'queued' })
    const analyzingTurn = { ...queuedTurn, state: 'analyzing' as const }
    const planningTurn = { ...queuedTurn, state: 'planning' as const }
    const markTurnAnalyzing = vi.fn(() => createTransition(analyzingTurn))
    const markTurnPlanning = vi.fn(() => createTransition(planningTurn))

    const result = advancePlanningTurn({
      activeTurn: queuedTurn,
      markTurnAnalyzing,
      markTurnPlanning,
    })

    expect(result.status).toBe('ready')
    expect(result.activeTurn?.state).toBe('planning')
    expect(result.transitions.map((item) => item.turn?.state)).toEqual(['analyzing', 'planning'])
  })

  it('returns blocked when the active turn is already blocked', () => {
    const blockedTurn = createTurn({
      state: 'blocked',
      blockedByTurnIds: ['turn_prev'],
      reason: 'Waiting for dependent turns: turn_prev',
    })

    const result = advancePlanningTurn({
      activeTurn: blockedTurn,
      markTurnAnalyzing: vi.fn(),
      markTurnPlanning: vi.fn(),
    })

    expect(result.status).toBe('blocked')
    expect(result.activeTurn).toEqual(blockedTurn)
    expect(result.transitions).toEqual([])
  })

  it('returns conflict when planning transition cannot proceed', () => {
    const queuedTurn = createTurn({ state: 'queued' })
    const analyzingTurn = { ...queuedTurn, state: 'analyzing' as const }
    const markTurnAnalyzing = vi.fn(() => createTransition(analyzingTurn))
    const markTurnPlanning = vi.fn(() => createTransition(analyzingTurn, 'conflict', 'Turn state conflict'))

    const result = advancePlanningTurn({
      activeTurn: queuedTurn,
      markTurnAnalyzing,
      markTurnPlanning,
    })

    expect(result.status).toBe('conflict')
    expect(result.errorMessage).toBe('Turn state conflict')
    expect(result.transitions.map((item) => item.turn?.state)).toEqual(['analyzing'])
  })
})

describe('handlePreflightClarification', () => {
  const question: PendingQuestion = {
    id: 'question_preflight',
    question: '请提供目标项目路径。',
    options: ['读取当前工作区（默认）', '我提供项目路径'],
    allowFreeText: true,
  }

  it('captures clarification and moves the turn to awaiting_clarification within limit', () => {
    const planningTurn = createTurn({ id: 'turn_preflight', state: 'planning' })
    const awaitingTurn = { ...planningTurn, state: 'awaiting_clarification' as const }
    const captureQuestionRequest = vi.fn()
    const markTurnAwaitingClarification = vi.fn(() => createTransition(awaitingTurn))

    const result = handlePreflightClarification({
      preflightClarification: question,
      nextRound: 1,
      maxClarificationRounds: 3,
      taskId: 'task_preflight',
      runId: 'run_preflight',
      activeTurn: planningTurn,
      captureQuestionRequest,
      markTurnAwaitingClarification,
      now: new Date('2026-03-21T13:00:00.000Z'),
      createMessageId: () => 'msg_preflight_1',
    })

    expect(result.status).toBe('awaiting_clarification')
    expect(captureQuestionRequest).toHaveBeenCalledWith(question, {
      taskId: 'task_preflight',
      runId: 'run_preflight',
      providerSessionId: 'run_preflight',
      source: 'clarification',
      round: 1,
    })
    expect(result.clarificationMessage?.type).toBe('clarification_request')
    expect(result.turnTransition?.turn?.state).toBe('awaiting_clarification')
    expect(result.activeTurn?.state).toBe('awaiting_clarification')
  })

  it('fails the turn and returns an error message when clarification round exceeds limit', () => {
    const planningTurn = createTurn({ id: 'turn_limit', state: 'planning' })
    const failedTurn = { ...planningTurn, state: 'failed' as const, reason: '澄清轮次超过上限（1）。请补充更完整需求后重试。' }
    const failTurn = vi.fn(() => createTransition(failedTurn))

    const result = handlePreflightClarification({
      preflightClarification: question,
      nextRound: 2,
      maxClarificationRounds: 1,
      taskId: 'task_limit',
      runId: 'run_limit',
      activeTurn: planningTurn,
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      failTurn,
      now: new Date('2026-03-21T13:01:00.000Z'),
      createMessageId: () => 'msg_limit_1',
    })

    expect(result.status).toBe('limit_exceeded')
    expect(result.errorMessage?.type).toBe('error')
    expect(String(result.errorMessage?.errorMessage || '')).toContain('澄清轮次超过上限（1）')
    expect(failTurn).toHaveBeenCalledWith('turn_limit', '澄清轮次超过上限（1）。请补充更完整需求后重试。')
    expect(result.turnTransition?.turn?.state).toBe('failed')
  })

  it('returns continue when there is no preflight clarification to apply', () => {
    const planningTurn = createTurn({ id: 'turn_continue', state: 'planning' })

    const result = handlePreflightClarification({
      preflightClarification: null,
      nextRound: 1,
      maxClarificationRounds: 3,
      taskId: 'task_continue',
      runId: 'run_continue',
      activeTurn: planningTurn,
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      now: new Date('2026-03-21T13:02:00.000Z'),
      createMessageId: () => 'unused',
    })

    expect(result.status).toBe('continue')
    expect(result.activeTurn).toEqual(planningTurn)
    expect(result.clarificationMessage).toBeNull()
    expect(result.errorMessage).toBeNull()
  })
})

describe('handleBlockedClarificationLimit', () => {
  it('fails the blocked turn when clarification rounds already exceeded the limit', () => {
    const blockedTurn = createTurn({
      id: 'turn_blocked_limit',
      state: 'blocked',
      blockedByTurnIds: ['turn_prev'],
      reason: 'Waiting for dependent turns: turn_prev',
    })
    const failedTurn = {
      ...blockedTurn,
      state: 'failed' as const,
      reason: '澄清轮次超过上限（1）。请补充更完整需求后重试。',
    }
    const failTurn = vi.fn(() => createTransition(failedTurn))

    const result = handleBlockedClarificationLimit({
      hasPendingClarification: true,
      nextRound: 2,
      maxClarificationRounds: 1,
      activeTurn: blockedTurn,
      failTurn,
      now: new Date('2026-03-21T13:03:00.000Z'),
      createMessageId: () => 'msg_blocked_limit_1',
    })

    expect(result.status).toBe('limit_exceeded')
    expect(result.errorMessage?.type).toBe('error')
    expect(String(result.errorMessage?.errorMessage || '')).toContain('澄清轮次超过上限（1）')
    expect(failTurn).toHaveBeenCalledWith('turn_blocked_limit', '澄清轮次超过上限（1）。请补充更完整需求后重试。')
    expect(result.turnTransition?.turn?.state).toBe('failed')
    expect(result.activeTurn?.state).toBe('failed')
  })

  it('returns continue when clarification is not pending or still within limit', () => {
    const blockedTurn = createTurn({
      id: 'turn_blocked_continue',
      state: 'blocked',
      blockedByTurnIds: ['turn_prev'],
      reason: 'Waiting for dependent turns: turn_prev',
    })

    const noPending = handleBlockedClarificationLimit({
      hasPendingClarification: false,
      nextRound: 3,
      maxClarificationRounds: 1,
      activeTurn: blockedTurn,
      failTurn: vi.fn(),
      now: new Date('2026-03-21T13:04:00.000Z'),
      createMessageId: () => 'unused_1',
    })

    const withinLimit = handleBlockedClarificationLimit({
      hasPendingClarification: true,
      nextRound: 1,
      maxClarificationRounds: 1,
      activeTurn: blockedTurn,
      failTurn: vi.fn(),
      now: new Date('2026-03-21T13:05:00.000Z'),
      createMessageId: () => 'unused_2',
    })

    expect(noPending.status).toBe('continue')
    expect(noPending.errorMessage).toBeNull()
    expect(withinLimit.status).toBe('continue')
    expect(withinLimit.errorMessage).toBeNull()
  })
})
