import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import type { PlanningStreamState } from '../planning-stream-processing'
import { runPlanningStreamLoop } from '../planning-stream-loop'

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_planning_loop',
    taskId: 'task_planning_loop',
    runId: 'run_planning_loop',
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

function createPlanningState(
  overrides: Partial<PlanningStreamState> = {}
): PlanningStreamState {
  return {
    planResult: null,
    isDirectAnswer: false,
    directAnswer: '',
    sawPlaceholderText: false,
    clarificationLimitExceeded: false,
    ...overrides,
  }
}

describe('runPlanningStreamLoop', () => {
  it('forwards handler-approved messages and carries updated state forward', async () => {
    const messageOne: AgentMessage = {
      id: 'msg_1',
      type: 'session',
      sessionId: 'run_planning_loop',
      timestamp: 1,
    }
    const messageTwo: AgentMessage = {
      id: 'msg_2',
      type: 'plan',
      role: 'assistant',
      content: '生成计划',
      timestamp: 2,
      plan: {
        id: 'plan_1',
        goal: 'Goal',
        steps: [{ id: 'step_1', description: 'Step 1', status: 'pending' }],
        createdAt: new Date('2026-03-22T11:00:00.000Z'),
      },
    }
    const emitMessage = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const nextTurn = createTurn({ id: 'turn_updated' })
    const handleMessage = vi
      .fn()
      .mockResolvedValueOnce({
        planningState: createPlanningState(),
        activeTurn: createTurn(),
        turnTransition: null,
        errorMessage: null,
        shouldBreak: false,
        shouldForward: false,
      })
      .mockResolvedValueOnce({
        planningState: createPlanningState({ directAnswer: 'Answer' }),
        activeTurn: nextTurn,
        turnTransition: null,
        errorMessage: null,
        shouldBreak: false,
        shouldForward: true,
      })

    const result = await runPlanningStreamLoop({
      initialPlanningState: createPlanningState(),
      initialActiveTurn: createTurn(),
      streamPlanning: async function* () {
        yield messageOne
        yield messageTwo
      },
      isAborted: () => false,
      handleMessage,
      emitMessage,
      emitMessagesAndTurnTransition,
    })

    expect(handleMessage).toHaveBeenCalledTimes(2)
    expect(emitMessagesAndTurnTransition).not.toHaveBeenCalled()
    expect(emitMessage).toHaveBeenCalledTimes(1)
    expect(emitMessage).toHaveBeenCalledWith(messageTwo)
    expect(result.planningState.directAnswer).toBe('Answer')
    expect(result.activeTurn).toBe(nextTurn)
  })

  it('emits error transition and stops when handler asks to break', async () => {
    const failedTurn = createTurn({ id: 'turn_failed', state: 'failed' })
    const limitError: AgentMessage = {
      id: 'msg_error',
      type: 'error',
      errorMessage: '澄清轮次超过上限（1）。请补充更完整需求后重试。',
      timestamp: 3,
    }
    const emitMessage = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const handleMessage = vi
      .fn()
      .mockResolvedValue({
        planningState: createPlanningState({ clarificationLimitExceeded: true }),
        activeTurn: failedTurn,
        turnTransition: createTransition(failedTurn),
        errorMessage: limitError,
        shouldBreak: true,
        shouldForward: false,
      })

    const result = await runPlanningStreamLoop({
      initialPlanningState: createPlanningState(),
      initialActiveTurn: createTurn(),
      streamPlanning: async function* () {
        yield {
          id: 'clarify_msg',
          type: 'clarification_request',
          role: 'assistant',
          content: 'Need clarification',
          timestamp: 4,
        }
        yield {
          id: 'plan_should_not_emit',
          type: 'plan',
          role: 'assistant',
          content: 'ignored',
          timestamp: 5,
        }
      },
      isAborted: () => false,
      handleMessage,
      emitMessage,
      emitMessagesAndTurnTransition,
    })

    expect(handleMessage).toHaveBeenCalledTimes(1)
    expect(emitMessagesAndTurnTransition).toHaveBeenCalledWith({
      messages: [limitError],
      turnTransition: expect.objectContaining({
        turn: expect.objectContaining({ id: 'turn_failed', state: 'failed' }),
      }),
    })
    expect(emitMessage).not.toHaveBeenCalled()
    expect(result.planningState.clarificationLimitExceeded).toBe(true)
    expect(result.activeTurn?.state).toBe('failed')
  })

  it('stops before handling messages when the run is already aborted', async () => {
    const handleMessage = vi.fn()
    const emitMessage = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})

    const result = await runPlanningStreamLoop({
      initialPlanningState: createPlanningState(),
      initialActiveTurn: createTurn(),
      streamPlanning: async function* () {
        yield {
          id: 'msg_after_abort',
          type: 'plan',
          role: 'assistant',
          content: 'ignored',
          timestamp: 6,
        }
      },
      isAborted: () => true,
      handleMessage,
      emitMessage,
      emitMessagesAndTurnTransition,
    })

    expect(handleMessage).not.toHaveBeenCalled()
    expect(emitMessage).not.toHaveBeenCalled()
    expect(emitMessagesAndTurnTransition).not.toHaveBeenCalled()
    expect(result.wasAborted).toBe(true)
  })
})
