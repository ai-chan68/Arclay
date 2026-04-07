import { describe, expect, it, vi } from 'vitest'
import type { PendingQuestion } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import { resolvePlanningEntry } from '../planning-entry'

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_plan_entry',
    taskId: 'task_plan_entry',
    runId: 'run_plan_entry',
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

describe('resolvePlanningEntry', () => {
  it('returns continue with emitted planning transitions when entry can proceed', () => {
    const queuedTurn = createTurn({ state: 'queued' })
    const analyzingTurn = { ...queuedTurn, state: 'analyzing' as const }
    const planningTurn = { ...queuedTurn, state: 'planning' as const }
    const question: PendingQuestion = {
      id: 'question_unused',
      question: '请提供项目路径',
      allowFreeText: true,
    }

    const result = resolvePlanningEntry({
      planningPrompt: '读取 /workspace/easeWork 项目代码并总结最近最值得优化的 5 个点',
      taskId: 'task_plan_entry',
      runId: 'run_plan_entry',
      maxClarificationRounds: 3,
      activeTurn: queuedTurn,
      hasPendingClarification: () => false,
      getNextClarificationRound: () => 1,
      detectPreflightClarification: () => null,
      advancePlanningTurn: () => ({
        status: 'ready',
        activeTurn: planningTurn,
        transitions: [
          createTransition(analyzingTurn),
          createTransition(planningTurn),
        ],
        conflictTransition: null,
        errorMessage: null,
      }),
      handleBlockedClarificationLimit: vi.fn(),
      handlePreflightClarification: vi.fn(() => ({
        status: 'continue',
        activeTurn: planningTurn,
        turnTransition: null,
        clarificationMessage: null,
        errorMessage: null,
      })),
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      preflightQuestion: question,
    })

    expect(result.status).toBe('continue')
    expect(result.activeTurn?.state).toBe('planning')
    expect(result.transitions.map((item) => item.turn?.state)).toEqual(['analyzing', 'planning'])
    expect(result.messages).toEqual([])
  })

  it('returns blocked terminal payload when the turn is blocked by dependencies', () => {
    const blockedTurn = createTurn({
      id: 'turn_blocked',
      state: 'blocked',
      blockedByTurnIds: ['turn_prev'],
      reason: 'Waiting for dependent turns: turn_prev',
    })

    const result = resolvePlanningEntry({
      planningPrompt: 'plan',
      taskId: 'task_plan_entry',
      runId: 'run_plan_entry',
      maxClarificationRounds: 3,
      activeTurn: blockedTurn,
      hasPendingClarification: () => false,
      getNextClarificationRound: () => 1,
      detectPreflightClarification: () => null,
      advancePlanningTurn: () => ({
        status: 'blocked',
        activeTurn: blockedTurn,
        transitions: [],
        conflictTransition: null,
        errorMessage: null,
      }),
      handleBlockedClarificationLimit: () => ({
        status: 'continue',
        activeTurn: blockedTurn,
        turnTransition: null,
        errorMessage: null,
      }),
      handlePreflightClarification: vi.fn(),
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'msg_blocked',
      preflightQuestion: null,
    })

    expect(result.status).toBe('blocked_done')
    expect(result.blockedMessage?.type).toBe('text')
    expect(result.blockedMessage?.content).toContain('依赖回合：turn_prev')
    expect(result.fallbackTurn?.state).toBe('blocked')
  })

  it('returns terminal error when blocked clarification rounds already exceeded the limit', () => {
    const blockedTurn = createTurn({
      id: 'turn_blocked_limit',
      state: 'blocked',
      blockedByTurnIds: ['turn_prev'],
    })
    const failedTurn = { ...blockedTurn, state: 'failed' as const }

    const result = resolvePlanningEntry({
      planningPrompt: 'plan',
      taskId: 'task_plan_entry',
      runId: 'run_plan_entry',
      maxClarificationRounds: 1,
      activeTurn: blockedTurn,
      hasPendingClarification: () => true,
      getNextClarificationRound: () => 2,
      detectPreflightClarification: () => null,
      advancePlanningTurn: () => ({
        status: 'blocked',
        activeTurn: blockedTurn,
        transitions: [],
        conflictTransition: null,
        errorMessage: null,
      }),
      handleBlockedClarificationLimit: () => ({
        status: 'limit_exceeded',
        activeTurn: failedTurn,
        turnTransition: createTransition(failedTurn),
        errorMessage: {
          id: 'msg_limit',
          type: 'error',
          errorMessage: '澄清轮次超过上限（1）。请补充更完整需求后重试。',
          timestamp: 1,
        },
      }),
      handlePreflightClarification: vi.fn(),
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      preflightQuestion: null,
    })

    expect(result.status).toBe('messages_turn_done')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.type).toBe('error')
    expect(result.turnTransition?.turn?.state).toBe('failed')
  })

  it('returns terminal error when planning transition conflicts', () => {
    const queuedTurn = createTurn({ state: 'queued' })

    const result = resolvePlanningEntry({
      planningPrompt: 'plan',
      taskId: 'task_plan_entry',
      runId: 'run_plan_entry',
      maxClarificationRounds: 3,
      activeTurn: queuedTurn,
      hasPendingClarification: () => false,
      getNextClarificationRound: () => 1,
      detectPreflightClarification: () => null,
      advancePlanningTurn: () => ({
        status: 'conflict',
        activeTurn: queuedTurn,
        transitions: [],
        conflictTransition: null,
        errorMessage: '回合状态冲突，无法进入规划阶段。',
      }),
      handleBlockedClarificationLimit: vi.fn(),
      handlePreflightClarification: vi.fn(),
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'msg_conflict',
      preflightQuestion: null,
    })

    expect(result.status).toBe('messages_done')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.type).toBe('error')
    expect(result.messages[0]?.errorMessage).toContain('回合状态冲突')
  })

  it('returns clarification terminal payload when preflight asks for more information', () => {
    const planningTurn = createTurn({ id: 'turn_preflight', state: 'planning' })
    const awaitingTurn = { ...planningTurn, state: 'awaiting_clarification' as const }
    const question: PendingQuestion = {
      id: 'question_preflight',
      question: '请提供目标项目路径。',
      allowFreeText: true,
    }

    const result = resolvePlanningEntry({
      planningPrompt: '读取项目代码并总结最近最值得优化的 5 个点',
      taskId: 'task_plan_entry',
      runId: 'run_plan_entry',
      maxClarificationRounds: 3,
      activeTurn: planningTurn,
      hasPendingClarification: () => false,
      getNextClarificationRound: () => 1,
      detectPreflightClarification: () => question,
      advancePlanningTurn: () => ({
        status: 'ready',
        activeTurn: planningTurn,
        transitions: [],
        conflictTransition: null,
        errorMessage: null,
      }),
      handleBlockedClarificationLimit: vi.fn(),
      handlePreflightClarification: () => ({
        status: 'awaiting_clarification',
        activeTurn: awaitingTurn,
        turnTransition: createTransition(awaitingTurn),
        clarificationMessage: {
          id: 'msg_clarify',
          type: 'clarification_request',
          role: 'assistant',
          content: question.question,
          clarification: question,
          question,
          timestamp: 2,
        },
        errorMessage: null,
      }),
      captureQuestionRequest: vi.fn(),
      markTurnAwaitingClarification: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      preflightQuestion: question,
    })

    expect(result.status).toBe('messages_turn_done')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.type).toBe('clarification_request')
    expect(result.turnTransition?.turn?.state).toBe('awaiting_clarification')
  })
})
