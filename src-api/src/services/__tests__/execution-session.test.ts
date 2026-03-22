import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import type { ExecutionCompletionSummary } from '../execution-completion'
import { runExecutionSession } from '../execution-session'
import { runExecutionAttemptLoop } from '../execution-attempt-loop'
import { resolveExecutionPostRun } from '../execution-post-run'
import { finalizeExecutionLifecycle } from '../execution-lifecycle'

vi.mock('../execution-attempt-loop', () => ({
  runExecutionAttemptLoop: vi.fn(),
}))

vi.mock('../execution-post-run', () => ({
  resolveExecutionPostRun: vi.fn(),
}))

vi.mock('../execution-lifecycle', () => ({
  finalizeExecutionLifecycle: vi.fn(),
}))

function createPlan(): TaskPlan {
  return {
    id: 'plan_exec_session',
    goal: 'Execute the plan',
    steps: [{ id: 'step_1', description: 'Run the plan', status: 'pending' }],
    createdAt: new Date('2026-03-22T13:00:00.000Z'),
  }
}

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_exec_session',
    taskId: 'task_exec_session',
    runId: 'run_exec_session',
    prompt: 'Execute the plan',
    state: 'executing',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
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

function createTransition(turn: TurnRecord): TurnTransitionResult {
  return {
    status: 'ok',
    turn,
    runtime: null,
  }
}

describe('runExecutionSession', () => {
  const mockedAttemptLoop = vi.mocked(runExecutionAttemptLoop)
  const mockedResolvePostRun = vi.mocked(resolveExecutionPostRun)
  const mockedFinalize = vi.mocked(finalizeExecutionLifecycle)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits session lifecycle, resolves post-run, and finalizes success', async () => {
    const activeTurn = createTurn()
    const completedTurn = { ...activeTurn, state: 'completed' as const }
    const executionSummary = createSummary()
    const emitMessage = vi.fn(async () => {})
    const emitMessages = vi.fn(async () => {})
    const emitTurnState = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const emitTurnTransitionAndDone = vi.fn(async () => {})
    const deleteRun = vi.fn()

    mockedAttemptLoop.mockResolvedValue({
      abortedByUser: false,
      executionFailed: false,
      executionFailureReason: '',
      runtimeGatePassed: true,
      runtimeGateResult: null,
    })
    mockedResolvePostRun.mockResolvedValue({
      status: 'completed',
      pendingInteractionCount: 0,
      activeTurn,
      turnTransition: null,
      executionAwaitingUser: false,
      executionInterrupted: false,
      executionFailed: false,
      executionFailureReason: '',
      messages: [],
    })
    mockedFinalize.mockResolvedValue({
      status: 'completed',
      activeTurn: completedTurn,
    })

    await runExecutionSession({
      planId: 'plan_exec_session',
      runId: 'run_exec_session',
      promptText: 'Run this plan',
      plan: createPlan(),
      activeTurn,
      executionTaskId: 'task_exec_session',
      executionPrompt: 'prompt',
      progressPath: '/tmp/progress.md',
      executionSummary,
      runtimeGateRequired: false,
      browserAutomationIntent: false,
      maxExecutionAttempts: 1,
      effectiveWorkDir: '/tmp/workdir',
      executionWorkspaceDir: '/tmp/workdir/sessions/task_exec_session',
      contextLogLines: ['### Execution Context', '- Provider: test'],
      streamExecution: vi.fn(),
      isAborted: () => false,
      processExecutionMessage: vi.fn(),
      createObservation: vi.fn(),
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn(),
      emitMessage,
      emitMessages,
      emitTurnState,
      emitMessagesAndTurnTransition,
      emitTurnTransitionAndDone,
      appendProgressEntry: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      deleteRun,
      formatExecutionSummary: () => 'summary=ok',
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      createId: (prefix) => `${prefix}_id`,
      buildRuntimeRepairPrompt: vi.fn(),
    })

    expect(emitMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session',
      sessionId: 'run_exec_session',
    }))
    expect(emitTurnState).toHaveBeenCalledWith({ turn: activeTurn })
    expect(mockedAttemptLoop).toHaveBeenCalledTimes(1)
    expect(mockedResolvePostRun).toHaveBeenCalledTimes(1)
    expect(emitMessagesAndTurnTransition).toHaveBeenCalledWith({
      messages: [],
      turnTransition: null,
    })
    expect(mockedFinalize).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan_exec_session',
      executionFailed: false,
      executionAwaitingUser: false,
      executionInterrupted: false,
      activeTurn,
    }))
    expect(emitTurnTransitionAndDone).toHaveBeenCalledWith({
      turn: completedTurn,
    })
    expect(deleteRun).toHaveBeenCalledWith('run_exec_session')
  })

  it('emits an error message and finalizes failure when execution throws', async () => {
    const activeTurn = createTurn()
    const failedTurn = { ...activeTurn, state: 'failed' as const, reason: 'boom' }
    const emitMessage = vi.fn(async () => {})
    const emitMessages = vi.fn(async () => {})
    const emitTurnState = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const emitTurnTransitionAndDone = vi.fn(async () => {})

    mockedAttemptLoop.mockRejectedValue(new Error('boom'))
    mockedFinalize.mockResolvedValue({
      status: 'failed',
      activeTurn: failedTurn,
    })

    await runExecutionSession({
      planId: 'plan_exec_session',
      runId: 'run_exec_session',
      promptText: 'Run this plan',
      plan: createPlan(),
      activeTurn,
      executionTaskId: 'task_exec_session',
      executionPrompt: 'prompt',
      progressPath: '/tmp/progress.md',
      executionSummary: createSummary(),
      runtimeGateRequired: false,
      browserAutomationIntent: false,
      maxExecutionAttempts: 1,
      effectiveWorkDir: '/tmp/workdir',
      executionWorkspaceDir: '/tmp/workdir/sessions/task_exec_session',
      contextLogLines: [],
      streamExecution: vi.fn(),
      isAborted: () => false,
      processExecutionMessage: vi.fn(),
      createObservation: vi.fn(),
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn(),
      emitMessage,
      emitMessages,
      emitTurnState,
      emitMessagesAndTurnTransition,
      emitTurnTransitionAndDone,
      appendProgressEntry: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      deleteRun: vi.fn(),
      formatExecutionSummary: () => 'summary=failed',
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      createId: (prefix) => `${prefix}_id`,
      buildRuntimeRepairPrompt: vi.fn(),
    })

    expect(mockedResolvePostRun).not.toHaveBeenCalled()
    expect(emitMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'error',
        errorMessage: 'boom',
      }),
    ])
    expect(mockedFinalize).toHaveBeenCalledWith(expect.objectContaining({
      executionFailed: true,
      executionFailureReason: 'boom',
    }))
    expect(emitTurnTransitionAndDone).toHaveBeenCalledWith({
      turn: failedTurn,
    })
  })

  it('marks runtime-gate failure as execution failure before post-run resolution', async () => {
    const activeTurn = createTurn()
    const emitMessage = vi.fn(async () => {})
    const emitMessages = vi.fn(async () => {})
    const emitTurnState = vi.fn(async () => {})
    const emitMessagesAndTurnTransition = vi.fn(async () => {})
    const emitTurnTransitionAndDone = vi.fn(async () => {})

    mockedAttemptLoop.mockResolvedValue({
      abortedByUser: false,
      executionFailed: false,
      executionFailureReason: '',
      runtimeGatePassed: false,
      runtimeGateResult: {
        passed: false,
        reason: 'Frontend server did not pass health check after execution.',
        checkedUrls: ['http://127.0.0.1:5173'],
        healthyUrls: [],
        previewUrl: null,
        frontendExpected: true,
        frontendHealthy: false,
        backendExpected: false,
        backendHealthy: false,
      },
    })
    mockedFinalize.mockResolvedValue({
      status: 'failed',
      activeTurn,
    })

    await runExecutionSession({
      planId: 'plan_exec_session',
      runId: 'run_exec_session',
      promptText: 'Run this plan',
      plan: createPlan(),
      activeTurn,
      executionTaskId: 'task_exec_session',
      executionPrompt: 'prompt',
      progressPath: '/tmp/progress.md',
      executionSummary: createSummary(),
      runtimeGateRequired: true,
      browserAutomationIntent: false,
      maxExecutionAttempts: 2,
      effectiveWorkDir: '/tmp/workdir',
      executionWorkspaceDir: '/tmp/workdir/sessions/task_exec_session',
      contextLogLines: [],
      streamExecution: vi.fn(),
      isAborted: () => false,
      processExecutionMessage: vi.fn(),
      createObservation: vi.fn(),
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn(),
      emitMessage,
      emitMessages,
      emitTurnState,
      emitMessagesAndTurnTransition,
      emitTurnTransitionAndDone,
      appendProgressEntry: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      deleteRun: vi.fn(),
      formatExecutionSummary: () => 'summary=gate-failed',
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      createId: (prefix) => `${prefix}_id`,
      buildRuntimeRepairPrompt: vi.fn(),
    })

    expect(mockedResolvePostRun).not.toHaveBeenCalled()
    expect(mockedFinalize).toHaveBeenCalledWith(expect.objectContaining({
      executionFailed: true,
      executionFailureReason: 'Runtime verification failed after execution.',
    }))
    expect(emitMessagesAndTurnTransition).not.toHaveBeenCalled()
  })
})
