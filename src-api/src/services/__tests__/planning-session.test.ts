import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import { runPlanningSession } from '../planning-session'

function createTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: 'turn_planning_session',
    taskId: 'task_planning_session',
    runId: 'run_planning_session',
    prompt: 'plan prompt',
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

function createTransition(turn: TurnRecord): TurnTransitionResult {
  return {
    status: 'ok',
    turn,
    runtime: null,
  }
}

function createPlan(): TaskPlan {
  return {
    id: 'plan_planning_session',
    goal: 'Goal',
    steps: [{ id: 'step_1', description: 'Step', status: 'pending' }],
    createdAt: new Date('2026-03-22T18:00:00.000Z'),
  }
}

describe('runPlanningSession', () => {
  const mockedResolveEntry = vi.fn()
  const mockedRunLoop = vi.fn()
  const mockedPostRun = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits session, advances through planning loop, resolves post-run, and emits done on success', async () => {
    const queuedTurn = createTurn({ state: 'queued' })
    const planningTurn = createTurn({ state: 'planning' })
    const awaitingApprovalTurn = createTurn({ state: 'awaiting_approval' })
    const emitMessage = vi.fn(async () => {})
    const emitMessages = vi.fn(async () => {})
    const emitTurnState = vi.fn(async () => {})
    const emitBlockedTurnAndDone = vi.fn(async () => {})
    const emitMessagesAndDone = vi.fn(async () => {})
    const emitMessagesTurnTransitionAndDone = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const emitTurnTransitionAndDone = vi.fn(async () => {})
    const deleteRun = vi.fn()

    mockedResolveEntry.mockReturnValue({
      status: 'continue',
      activeTurn: planningTurn,
      transitions: [createTransition(planningTurn)],
      turnTransition: null,
      messages: [],
      blockedMessage: null,
      fallbackTurn: null,
    })
    mockedRunLoop.mockResolvedValue({
      planningState: {
        planResult: createPlan(),
        isDirectAnswer: false,
        directAnswer: '',
        sawPlaceholderText: false,
        clarificationLimitExceeded: false,
      },
      activeTurn: planningTurn,
    })
    mockedPostRun.mockReturnValue({
      planningState: {
        planResult: createPlan(),
        isDirectAnswer: false,
        directAnswer: '',
        sawPlaceholderText: false,
        clarificationLimitExceeded: false,
      },
      activeTurn: awaitingApprovalTurn,
      messages: [
        {
          id: 'plan_message',
          type: 'plan',
          plan: createPlan(),
          role: 'assistant',
          content: 'plan ready',
          timestamp: 1,
        } as AgentMessage,
      ],
      turnTransition: createTransition(awaitingApprovalTurn),
    })

    await runPlanningSession({
      planningPrompt: 'plan prompt',
      rawPrompt: 'raw prompt',
      runId: 'run_planning_session',
      taskId: 'task_planning_session',
      maxClarificationRounds: 3,
      activeTurn: queuedTurn,
      streamPlanning: vi.fn(),
      isAborted: () => false,
      emitMessage,
      emitMessages,
      emitTurnState,
      emitBlockedTurnAndDone,
      emitMessagesAndDone,
      emitMessagesTurnTransitionAndDone,
      emitMessagesAndTurnTransition,
      emitTurnTransitionAndDone,
      deleteRun,
      resolvePlanningEntryInput: {
        hasPendingClarification: () => false,
        getNextClarificationRound: () => 1,
        detectPreflightClarification: vi.fn(() => null),
        advancePlanningTurn: vi.fn(),
        handleBlockedClarificationLimit: vi.fn(),
        handlePreflightClarification: vi.fn(),
        captureQuestionRequest: vi.fn(),
        markTurnAwaitingClarification: vi.fn(),
        failTurn: vi.fn(),
        createId: (prefix) => `${prefix}_id`,
      },
      planningLoopInput: {
        initialPlanningState: {
          planResult: null,
          isDirectAnswer: false,
          directAnswer: '',
          sawPlaceholderText: false,
          clarificationLimitExceeded: false,
        },
        handleMessage: vi.fn(),
      },
      planningPostRunInput: {
        upsertPendingPlan: vi.fn(),
        cancelTurn: vi.fn(),
        completeTurn: vi.fn(),
        markTurnAwaitingApproval: vi.fn(),
        createId: (prefix) => `${prefix}_id`,
      },
      resolvePlanningEntryFn: mockedResolveEntry as any,
      runPlanningStreamLoopFn: mockedRunLoop as any,
      resolvePlanningPostRunFn: mockedPostRun as any,
      failTurn: vi.fn(),
      createSessionMessage: vi.fn(() => ({
        id: 'session_msg',
        type: 'session',
        sessionId: 'run_planning_session',
        timestamp: 1,
      })),
      createDoneMessage: vi.fn(() => ({
        id: 'done_msg',
        type: 'done',
        timestamp: 2,
      })),
      createErrorMessage: vi.fn(),
    })

    expect(emitMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session',
      sessionId: 'run_planning_session',
    }))
    expect(emitTurnState).toHaveBeenCalledWith(createTransition(planningTurn))
    expect(mockedRunLoop).toHaveBeenCalledTimes(1)
    expect(mockedPostRun).toHaveBeenCalledTimes(1)
    expect(emitMessages).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({ type: 'plan' }),
      ],
    })
    expect(emitTurnTransitionAndDone).toHaveBeenCalledWith(expect.objectContaining({
      turnTransition: createTransition(awaitingApprovalTurn),
      emitTurnState,
    }))
    expect(deleteRun).toHaveBeenCalledWith('run_planning_session')
  })

  it('emits blocked branch and exits early', async () => {
    const blockedTurn = createTurn({ state: 'blocked', blockedByTurnIds: ['turn_prev'] })
    const emitBlockedTurnAndDone = vi.fn(async () => {})

    mockedResolveEntry.mockReturnValue({
      status: 'blocked_done',
      activeTurn: blockedTurn,
      transitions: [],
      turnTransition: null,
      messages: [],
      blockedMessage: {
        id: 'blocked_msg',
        type: 'text',
        role: 'assistant',
        content: '当前回合正在等待前序回合完成。',
        timestamp: 1,
      },
      fallbackTurn: blockedTurn,
    })

    await runPlanningSession({
      planningPrompt: 'plan prompt',
      rawPrompt: 'raw prompt',
      runId: 'run_planning_session',
      taskId: 'task_planning_session',
      maxClarificationRounds: 3,
      activeTurn: blockedTurn,
      streamPlanning: vi.fn(),
      isAborted: () => false,
      emitMessage: vi.fn(async () => {}),
      emitMessages: vi.fn(async () => {}),
      emitTurnState: vi.fn(async () => {}),
      emitBlockedTurnAndDone,
      emitMessagesAndDone: vi.fn(async () => {}),
      emitMessagesTurnTransitionAndDone: vi.fn(async () => {}),
      emitMessagesAndTurnTransition: vi.fn(async () => {}),
      emitTurnTransitionAndDone: vi.fn(async () => {}),
      deleteRun: vi.fn(),
      resolvePlanningEntryInput: {
        hasPendingClarification: () => false,
        getNextClarificationRound: () => 1,
        detectPreflightClarification: vi.fn(() => null),
        advancePlanningTurn: vi.fn(),
        handleBlockedClarificationLimit: vi.fn(),
        handlePreflightClarification: vi.fn(),
        captureQuestionRequest: vi.fn(),
        markTurnAwaitingClarification: vi.fn(),
        failTurn: vi.fn(),
        createId: (prefix) => `${prefix}_id`,
      },
      planningLoopInput: {
        initialPlanningState: {
          planResult: null,
          isDirectAnswer: false,
          directAnswer: '',
          sawPlaceholderText: false,
          clarificationLimitExceeded: false,
        },
        handleMessage: vi.fn(),
      },
      planningPostRunInput: {
        upsertPendingPlan: vi.fn(),
        cancelTurn: vi.fn(),
        completeTurn: vi.fn(),
        markTurnAwaitingApproval: vi.fn(),
        createId: (prefix) => `${prefix}_id`,
      },
      resolvePlanningEntryFn: mockedResolveEntry as any,
      runPlanningStreamLoopFn: mockedRunLoop as any,
      resolvePlanningPostRunFn: mockedPostRun as any,
      failTurn: vi.fn(),
      createSessionMessage: vi.fn(() => ({
        id: 'session_msg',
        type: 'session',
        sessionId: 'run_planning_session',
        timestamp: 1,
      })),
      createDoneMessage: vi.fn(() => ({
        id: 'done_msg',
        type: 'done',
        timestamp: 2,
      })),
      createErrorMessage: vi.fn(),
    })

    expect(emitBlockedTurnAndDone).toHaveBeenCalledTimes(1)
    expect(mockedRunLoop).not.toHaveBeenCalled()
    expect(mockedPostRun).not.toHaveBeenCalled()
  })

  it('fails active turn and emits message-first error branch when planning throws', async () => {
    const planningTurn = createTurn({ state: 'planning' })
    const failedTurn = createTurn({ state: 'failed', reason: 'boom' })
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const failTurn = vi.fn(() => createTransition(failedTurn))
    const createErrorMessage = vi.fn(() => ({
      id: 'error_msg',
      type: 'error',
      errorMessage: 'boom',
      timestamp: 3,
    }))

    mockedResolveEntry.mockReturnValue({
      status: 'continue',
      activeTurn: planningTurn,
      transitions: [],
      turnTransition: null,
      messages: [],
      blockedMessage: null,
      fallbackTurn: null,
    })
    mockedRunLoop.mockRejectedValue(new Error('boom'))

    await runPlanningSession({
      planningPrompt: 'plan prompt',
      rawPrompt: 'raw prompt',
      runId: 'run_planning_session',
      taskId: 'task_planning_session',
      maxClarificationRounds: 3,
      activeTurn: planningTurn,
      streamPlanning: vi.fn(),
      isAborted: () => false,
      emitMessage: vi.fn(async () => {}),
      emitMessages: vi.fn(async () => {}),
      emitTurnState: vi.fn(async () => {}),
      emitBlockedTurnAndDone: vi.fn(async () => {}),
      emitMessagesAndDone: vi.fn(async () => {}),
      emitMessagesTurnTransitionAndDone: vi.fn(async () => {}),
      emitMessagesAndTurnTransition,
      emitTurnTransitionAndDone: vi.fn(async () => {}),
      deleteRun: vi.fn(),
      resolvePlanningEntryInput: {
        hasPendingClarification: () => false,
        getNextClarificationRound: () => 1,
        detectPreflightClarification: vi.fn(() => null),
        advancePlanningTurn: vi.fn(),
        handleBlockedClarificationLimit: vi.fn(),
        handlePreflightClarification: vi.fn(),
        captureQuestionRequest: vi.fn(),
        markTurnAwaitingClarification: vi.fn(),
        failTurn: vi.fn(),
        createId: (prefix) => `${prefix}_id`,
      },
      planningLoopInput: {
        initialPlanningState: {
          planResult: null,
          isDirectAnswer: false,
          directAnswer: '',
          sawPlaceholderText: false,
          clarificationLimitExceeded: false,
        },
        handleMessage: vi.fn(),
      },
      planningPostRunInput: {
        upsertPendingPlan: vi.fn(),
        cancelTurn: vi.fn(),
        completeTurn: vi.fn(),
        markTurnAwaitingApproval: vi.fn(),
        createId: (prefix) => `${prefix}_id`,
      },
      resolvePlanningEntryFn: mockedResolveEntry as any,
      runPlanningStreamLoopFn: mockedRunLoop as any,
      resolvePlanningPostRunFn: mockedPostRun as any,
      failTurn,
      createSessionMessage: vi.fn(() => ({
        id: 'session_msg',
        type: 'session',
        sessionId: 'run_planning_session',
        timestamp: 1,
      })),
      createDoneMessage: vi.fn(),
      createErrorMessage,
    })

    expect(failTurn).toHaveBeenCalledWith('turn_planning_session', 'boom')
    expect(createErrorMessage).toHaveBeenCalledWith('boom')
    expect(emitMessagesAndTurnTransition).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({
          type: 'error',
          errorMessage: 'boom',
        }),
      ],
      turnTransition: createTransition(failedTurn),
      emitTurnState: expect.any(Function),
    })
  })
})
