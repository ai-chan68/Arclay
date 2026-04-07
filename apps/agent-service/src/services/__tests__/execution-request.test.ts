import { describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../agent-run-store'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord } from '../../types/turn-runtime'
import { prepareExecutionRequest } from '../execution-request'

function createRun(id = 'run_exec_request'): AgentRun {
  return {
    id,
    phase: 'execute',
    createdAt: new Date('2026-03-22T13:05:00.000Z'),
    isAborted: false,
    abortController: new AbortController(),
  }
}

function createPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id: 'plan_exec_request',
    goal: 'Execute request plan',
    steps: [
      {
        id: 'step_1',
        description: 'Run the requested execution',
        status: 'pending',
      },
    ],
    createdAt: new Date('2026-03-22T13:00:00.000Z'),
    ...overrides,
  }
}

function createTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: 'turn_exec_request',
    taskId: 'task_exec_request',
    runId: 'run_exec_request',
    prompt: 'Execute request plan',
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

describe('prepareExecutionRequest', () => {
  it('returns validation_error when planId is missing', async () => {
    const createRunSpy = vi.fn()

    const result = await prepareExecutionRequest({
      body: {
        prompt: 'Run this',
      },
      defaultWorkDir: '/workspace',
      createRun: createRunSpy,
      deleteRun: vi.fn(),
      executionStartDeps: {
        getPlanRecord: vi.fn(),
        getTurn: vi.fn(),
        findLatestTurnByTask: vi.fn(),
        startPlanExecution: vi.fn(),
        cancelExpiredPlanTurns: vi.fn(),
        startTurnExecution: vi.fn(),
        markPlanOrphaned: vi.fn(),
        bootstrapPlanningFiles: vi.fn(),
      },
    })

    expect(result).toEqual({
      status: 'validation_error',
      statusCode: 400,
      body: {
        error: 'planId is required',
      },
    })
    expect(createRunSpy).not.toHaveBeenCalled()
  })

  it('normalizes request body, reuses sessionId, and returns ready execution context', async () => {
    const run = createRun('session_exec_request')
    const prepareExecutionStartFn = vi.fn(async () => ({
      status: 'ready' as const,
      plan: createPlan(),
      activeTurn: createTurn(),
      effectiveTaskId: 'task_exec_request',
      executionTaskId: 'task_exec_request',
      effectiveWorkDir: '/custom/workdir',
      executionWorkspaceDir: '/custom/workdir/sessions/task_exec_request',
      progressFilePath: '/custom/workdir/sessions/task_exec_request/progress.md',
      planningFilesBootstrap: {
        sessionDir: '/custom/workdir/sessions/task_exec_request',
        createdFiles: ['task_plan.md'],
        skippedFiles: ['progress.md'],
      },
    }))

    const result = await prepareExecutionRequest({
      body: {
        planId: 'plan_exec_request',
        prompt: 'Run this',
        workDir: '/custom/workdir',
        taskId: '  task_exec_request  ',
        turnId: '  turn_exec_request  ',
        readVersion: 2.9,
        sessionId: 'session_exec_request',
        attachments: [{ name: 'spec.md', mimeType: 'text/markdown', data: 'ZGF0YQ==' }],
      },
      defaultWorkDir: '/workspace',
      createRun: vi.fn(() => run),
      deleteRun: vi.fn(),
      executionStartDeps: {
        getPlanRecord: vi.fn(),
        getTurn: vi.fn(),
        findLatestTurnByTask: vi.fn(),
        startPlanExecution: vi.fn(),
        cancelExpiredPlanTurns: vi.fn(),
        startTurnExecution: vi.fn(),
        markPlanOrphaned: vi.fn(),
        bootstrapPlanningFiles: vi.fn(),
      },
      prepareExecutionStartFn,
    })

    expect(prepareExecutionStartFn).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan_exec_request',
      prompt: 'Run this',
      runId: 'session_exec_request',
      requestedTaskId: 'task_exec_request',
      requestedTurnId: 'turn_exec_request',
      requestedReadVersion: 2,
      requestedWorkDir: '/custom/workdir',
      defaultWorkDir: '/workspace',
    }))
    expect(result).toEqual({
      status: 'ready',
      run,
      plan: createPlan(),
      activeTurn: createTurn(),
      effectiveTaskId: 'task_exec_request',
      executionTaskId: 'task_exec_request',
      effectiveWorkDir: '/custom/workdir',
      executionWorkspaceDir: '/custom/workdir/sessions/task_exec_request',
      progressFilePath: '/custom/workdir/sessions/task_exec_request/progress.md',
      planningFilesBootstrap: {
        sessionDir: '/custom/workdir/sessions/task_exec_request',
        createdFiles: ['task_plan.md'],
        skippedFiles: ['progress.md'],
      },
      promptText: 'Run this',
      attachments: [{ name: 'spec.md', mimeType: 'text/markdown', data: 'ZGF0YQ==' }],
    })
  })

  it('maps missing plan lookup to a 404 response and deletes the run', async () => {
    const deleteRun = vi.fn()

    const result = await prepareExecutionRequest({
      body: {
        planId: 'missing_plan',
      },
      defaultWorkDir: '/workspace',
      createRun: vi.fn(() => createRun()),
      deleteRun,
      executionStartDeps: {
        getPlanRecord: vi.fn(),
        getTurn: vi.fn(),
        findLatestTurnByTask: vi.fn(),
        startPlanExecution: vi.fn(),
        cancelExpiredPlanTurns: vi.fn(),
        startTurnExecution: vi.fn(),
        markPlanOrphaned: vi.fn(),
        bootstrapPlanningFiles: vi.fn(),
      },
      prepareExecutionStartFn: vi.fn(async () => ({
        status: 'not_found',
      })),
    })

    expect(result).toEqual({
      status: 'response',
      statusCode: 404,
      body: {
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND',
      },
    })
    expect(deleteRun).toHaveBeenCalledWith('run_exec_request')
  })

  it('maps turn conflicts to a 409 response and deletes the run', async () => {
    const deleteRun = vi.fn()

    const result = await prepareExecutionRequest({
      body: {
        planId: 'plan_exec_request',
      },
      defaultWorkDir: '/workspace',
      createRun: vi.fn(() => createRun()),
      deleteRun,
      executionStartDeps: {
        getPlanRecord: vi.fn(),
        getTurn: vi.fn(),
        findLatestTurnByTask: vi.fn(),
        startPlanExecution: vi.fn(),
        cancelExpiredPlanTurns: vi.fn(),
        startTurnExecution: vi.fn(),
        markPlanOrphaned: vi.fn(),
        bootstrapPlanningFiles: vi.fn(),
      },
      prepareExecutionStartFn: vi.fn(async () => ({
        status: 'turn_conflict',
        error: 'Task version mismatch: expected 3, actual 7.',
        code: 'TURN_VERSION_CONFLICT',
        turnState: 'awaiting_approval',
        taskVersion: 7,
      })),
    })

    expect(result).toEqual({
      status: 'response',
      statusCode: 409,
      body: {
        error: 'Task version mismatch: expected 3, actual 7.',
        code: 'TURN_VERSION_CONFLICT',
        turnState: 'awaiting_approval',
        taskVersion: 7,
      },
    })
    expect(deleteRun).toHaveBeenCalledWith('run_exec_request')
  })
})
