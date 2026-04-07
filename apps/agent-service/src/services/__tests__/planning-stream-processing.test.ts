import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import {
  createPlanningStreamState,
  processPlanningStreamMessage,
} from '../planning-stream-processing'

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_plan_stream',
    taskId: 'task_plan_stream',
    runId: 'run_plan_stream',
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
    id: 'plan_stream',
    goal: 'Deliver the task',
    steps: [
      {
        id: 'step_1',
        description: 'Analyze requirements',
        status: 'pending',
      },
    ],
    createdAt: new Date('2026-03-22T08:00:00.000Z'),
    ...overrides,
  }
}

describe('processPlanningStreamMessage', () => {
  it('captures clarification requests within limit and keeps forwarding the provider message', () => {
    const planningState = createPlanningStreamState()
    const captureQuestionRequest = vi.fn()
    const capturePendingInteraction = vi.fn()
    const question = {
      id: 'question_1',
      question: '请确认目标环境。',
      options: ['测试', '生产'],
      allowFreeText: true,
    }
    const message: AgentMessage = {
      id: 'clarify_msg_1',
      type: 'clarification_request',
      role: 'assistant',
      clarification: question,
      question,
      content: question.question,
      timestamp: 1,
    }

    const result = processPlanningStreamMessage({
      message,
      planningState,
      maxClarificationRounds: 2,
      taskId: 'task_stream',
      runId: 'run_stream',
      activeTurn: createTurn(),
      getNextClarificationRound: () => 1,
      captureQuestionRequest,
      capturePendingInteraction,
      upsertPendingPlan: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      now: new Date('2026-03-22T09:00:00.000Z'),
    })

    expect(result.shouldForward).toBe(true)
    expect(result.shouldBreak).toBe(false)
    expect(result.errorMessage).toBeNull()
    expect(captureQuestionRequest).toHaveBeenCalledWith(question, {
      taskId: 'task_stream',
      runId: 'run_stream',
      providerSessionId: 'run_stream',
      source: 'clarification',
      round: 1,
    })
    expect(capturePendingInteraction).not.toHaveBeenCalled()
  })

  it('fails the turn and stops the loop when clarification rounds exceed the limit', () => {
    const planningTurn = createTurn({ id: 'turn_limit' })
    const failedTurn = {
      ...planningTurn,
      state: 'failed' as const,
      reason: '澄清轮次超过上限（1）。请补充更完整需求后重试。',
    }
    const failTurn = vi.fn(() => createTransition(failedTurn))
    const message: AgentMessage = {
      id: 'clarify_msg_limit',
      type: 'clarification_request',
      role: 'assistant',
      clarification: {
        id: 'question_limit',
        question: '需要补充系统类型。',
      },
      content: '需要补充系统类型。',
      timestamp: 2,
    }

    const result = processPlanningStreamMessage({
      message,
      planningState: createPlanningStreamState(),
      maxClarificationRounds: 1,
      taskId: 'task_stream',
      runId: 'run_stream',
      activeTurn: planningTurn,
      getNextClarificationRound: () => 2,
      captureQuestionRequest: vi.fn(),
      capturePendingInteraction: vi.fn(),
      upsertPendingPlan: vi.fn(),
      failTurn,
      createId: () => 'msg_limit_error',
      now: new Date('2026-03-22T09:01:00.000Z'),
    })

    expect(result.shouldForward).toBe(false)
    expect(result.shouldBreak).toBe(true)
    expect(result.planningState.clarificationLimitExceeded).toBe(true)
    expect(result.errorMessage?.type).toBe('error')
    expect(String(result.errorMessage?.errorMessage || '')).toContain('澄清轮次超过上限（1）')
    expect(failTurn).toHaveBeenCalledWith('turn_limit', '澄清轮次超过上限（1）。请补充更完整需求后重试。')
    expect(result.turnTransition?.turn?.state).toBe('failed')
    expect(result.activeTurn?.state).toBe('failed')
  })

  it('persists plan messages into the pending plan store', () => {
    const plan = createPlan()
    const upsertPendingPlan = vi.fn()
    const message: AgentMessage = {
      id: 'plan_msg_1',
      type: 'plan',
      role: 'assistant',
      plan,
      content: '生成计划',
      timestamp: 3,
    }

    const result = processPlanningStreamMessage({
      message,
      planningState: createPlanningStreamState(),
      maxClarificationRounds: 2,
      taskId: 'task_stream',
      runId: 'run_stream',
      activeTurn: createTurn({ id: 'turn_plan_store' }),
      getNextClarificationRound: () => 1,
      captureQuestionRequest: vi.fn(),
      capturePendingInteraction: vi.fn(),
      upsertPendingPlan,
      failTurn: vi.fn(),
      createId: () => 'unused',
      now: new Date('2026-03-22T09:02:00.000Z'),
    })

    expect(result.shouldForward).toBe(true)
    expect(result.planningState.planResult).toEqual(plan)
    expect(upsertPendingPlan).toHaveBeenCalledWith(plan, {
      taskId: 'task_stream',
      runId: 'run_stream',
      turnId: 'turn_plan_store',
    })
  })

  it('marks placeholder assistant text without treating it as a direct answer', () => {
    const message: AgentMessage = {
      id: 'text_placeholder_1',
      type: 'text',
      role: 'assistant',
      content: '我会先搜索相关资料并整理方案。',
      timestamp: 4,
    }

    const result = processPlanningStreamMessage({
      message,
      planningState: createPlanningStreamState(),
      maxClarificationRounds: 2,
      taskId: 'task_stream',
      runId: 'run_stream',
      activeTurn: createTurn(),
      getNextClarificationRound: () => 1,
      captureQuestionRequest: vi.fn(),
      capturePendingInteraction: vi.fn(),
      upsertPendingPlan: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      now: new Date('2026-03-22T09:03:00.000Z'),
    })

    expect(result.planningState.directAnswer).toBe('我会先搜索相关资料并整理方案。')
    expect(result.planningState.sawPlaceholderText).toBe(true)
    expect(result.planningState.isDirectAnswer).toBe(false)
  })

  it('marks substantive assistant text as a direct answer candidate', () => {
    const message: AgentMessage = {
      id: 'text_answer_1',
      type: 'text',
      role: 'assistant',
      content: '结论是先抽离 planning stream 处理，再统一收尾状态。',
      timestamp: 5,
    }

    const result = processPlanningStreamMessage({
      message,
      planningState: createPlanningStreamState(),
      maxClarificationRounds: 2,
      taskId: 'task_stream',
      runId: 'run_stream',
      activeTurn: createTurn(),
      getNextClarificationRound: () => 1,
      captureQuestionRequest: vi.fn(),
      capturePendingInteraction: vi.fn(),
      upsertPendingPlan: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      now: new Date('2026-03-22T09:04:00.000Z'),
    })

    expect(result.planningState.directAnswer).toBe('结论是先抽离 planning stream 处理，再统一收尾状态。')
    expect(result.planningState.sawPlaceholderText).toBe(false)
    expect(result.planningState.isDirectAnswer).toBe(true)
  })

  it('skips forwarding session messages because the route already emitted them', () => {
    const capturePendingInteraction = vi.fn()
    const message: AgentMessage = {
      id: 'session_msg_1',
      type: 'session',
      sessionId: 'run_stream',
      timestamp: 6,
    }

    const result = processPlanningStreamMessage({
      message,
      planningState: createPlanningStreamState(),
      maxClarificationRounds: 2,
      taskId: 'task_stream',
      runId: 'run_stream',
      activeTurn: createTurn(),
      getNextClarificationRound: () => 1,
      captureQuestionRequest: vi.fn(),
      capturePendingInteraction,
      upsertPendingPlan: vi.fn(),
      failTurn: vi.fn(),
      createId: () => 'unused',
      now: new Date('2026-03-22T09:05:00.000Z'),
    })

    expect(result.shouldForward).toBe(false)
    expect(result.shouldBreak).toBe(false)
    expect(capturePendingInteraction).toHaveBeenCalledWith(message, {
      taskId: 'task_stream',
      runId: 'run_stream',
      providerSessionId: 'run_stream',
    })
  })
})
