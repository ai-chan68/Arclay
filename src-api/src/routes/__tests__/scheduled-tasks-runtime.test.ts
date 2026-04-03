import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { AgentRuntimeState } from '../../runtime/app-runtime'
import type { ScheduledTask } from '../../types/scheduled-task'

const bootstrapPlanningFilesMock = vi.fn(async () => ({
  sessionDir: '/tmp/runtime/sessions/task-1',
  createdFiles: [],
  skippedFiles: [],
}))

const scheduledTaskStoreMock = {
  getTask: vi.fn(),
  createRun: vi.fn(),
  updateTaskRuntime: vi.fn(),
  finalizeRun: vi.fn(),
  listRunningRuns: vi.fn(() => []),
  listDueTasks: vi.fn(() => []),
}

vi.mock('../../config', () => ({
  getWorkDir: () => '/tmp/default-workdir',
}))

vi.mock('../../services/planning-files', () => ({
  bootstrapPlanningFiles: bootstrapPlanningFilesMock,
}))

vi.mock('../../services/scheduled-task-store', () => ({
  scheduledTaskDefaults: {
    timezone: 'Asia/Shanghai',
  },
  scheduledTaskStore: scheduledTaskStoreMock,
}))

function createScheduledTaskFixture(): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Nightly sync',
    enabled: true,
    cronExpr: '*/10 * * * *',
    timezone: 'Asia/Shanghai',
    sourcePrompt: 'sync data',
    approvedPlan: {
      id: 'plan-1',
      goal: 'sync data',
      steps: [
        {
          id: 'step-1',
          description: 'sync data',
          status: 'pending',
        },
      ],
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
    },
    executionPromptSnapshot: 'run sync',
    workDir: '/tmp/runtime-workdir',
    nextRunAt: Date.now(),
    lastRunAt: null,
    lastStatus: 'idle',
    consecutiveFailures: 0,
    breakerState: 'closed',
    breakerOpenedAt: null,
    breakerCooldownUntil: null,
    breakerOpenCount24h: 0,
    breakerOpenWindowStartedAt: null,
    autoDisabledByBreaker: false,
    maxConsecutiveFailures: 3,
    cooldownSeconds: 600,
    timeoutSeconds: 60,
    overlapPolicy: 'forbid',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('Scheduled task runtime access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scheduledTaskStoreMock.listRunningRuns.mockReturnValue([])
    scheduledTaskStoreMock.listDueTasks.mockReturnValue([])
  })

  it('requires explicit deps when creating scheduled-task routes and scheduler', async () => {
    const { createScheduledTaskRoutes } = await import('../scheduled-tasks')
    const { ScheduledTaskScheduler } = await import('../../services/scheduled-task-scheduler')

    expect(() => createScheduledTaskRoutes()).toThrow(/explicit scheduled task route deps/i)
    expect(() => new ScheduledTaskScheduler()).toThrow(/explicit scheduled task scheduler deps/i)
  })

  it('reads plan-suggest runtime from injected deps instead of route globals', async () => {
    const planned: AgentMessage = {
      id: 'plan-message',
      type: 'plan',
      timestamp: Date.now(),
      plan: {
        id: 'suggested-plan',
        goal: 'sync data',
        steps: [
          {
            id: 'step-1',
            description: 'sync data',
            status: 'pending',
          },
        ],
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
      },
    }

    const runtimeState: AgentRuntimeState = {
      agentService: {
        createAgent: () => ({
          plan: async function* () {
            yield planned
          },
        }),
      } as never,
      agentServiceConfig: null,
    }

    const { createScheduledTaskRoutes } = await import('../scheduled-tasks')
    const routes = createScheduledTaskRoutes({
      workDir: '/tmp/default-workdir',
      getAgentRuntimeState: () => runtimeState,
      scheduler: {
        runNow: vi.fn(),
      },
    })

    const response = await routes.request('/plan/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'schedule a nightly sync',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      plan: {
        ...planned.plan,
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    })
  })

  it('returns a runtime error when injected scheduled-task runtime has no agent service', async () => {
    const { createScheduledTaskRoutes } = await import('../scheduled-tasks')
    const routes = createScheduledTaskRoutes({
      workDir: '/tmp/default-workdir',
      getAgentRuntimeState: () => ({
        agentService: null,
        agentServiceConfig: null,
      }),
      scheduler: {
        runNow: vi.fn(),
      },
    })

    const response = await routes.request('/plan/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'schedule a nightly sync',
      }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Agent service not initialized',
    })
  })

  it('executes runNow using the injected scheduler runtime accessor', async () => {
    const task = createScheduledTaskFixture()
    const streamExecutionMock = vi.fn(async function* (): AsyncIterable<AgentMessage> {
      yield {
        id: 'assistant-text',
        type: 'text',
        role: 'assistant',
        content: 'task complete',
        timestamp: Date.now(),
      }
      yield {
        id: 'assistant-done',
        type: 'done',
        timestamp: Date.now(),
      }
    })

    const runtimeState: AgentRuntimeState = {
      agentService: {
        abort: vi.fn(),
        streamExecution: streamExecutionMock,
      } as never,
      agentServiceConfig: null,
    }

    scheduledTaskStoreMock.getTask
      .mockReturnValueOnce(task)
      .mockReturnValueOnce(task)
      .mockReturnValueOnce(task)
      .mockReturnValueOnce(task)
    scheduledTaskStoreMock.createRun.mockReturnValue({
      id: 'run-1',
      taskId: task.id,
      triggerType: 'manual',
      scheduledAt: null,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'running',
      errorCode: null,
      errorMessage: null,
      durationMs: null,
      sessionId: null,
      meta: null,
    })
    scheduledTaskStoreMock.finalizeRun.mockImplementation((runId: string, status: string, errorCode: string | null, errorMessage: string | null, sessionId: string | null, meta: Record<string, unknown>) => ({
      id: runId,
      taskId: task.id,
      triggerType: 'manual',
      scheduledAt: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      status,
      errorCode,
      errorMessage,
      durationMs: 10,
      sessionId,
      meta,
    }))

    const { ScheduledTaskScheduler } = await import('../../services/scheduled-task-scheduler')
    const scheduler = new ScheduledTaskScheduler({
      workDir: '/tmp/default-workdir',
      getAgentRuntimeState: () => runtimeState,
    })

    const result = await scheduler.runNow(task.id)

    expect(result.run.status).toBe('success')
    expect(streamExecutionMock).toHaveBeenCalledTimes(1)
    expect(streamExecutionMock.mock.calls[0]?.[4]).toEqual({
      workDir: '/tmp/runtime-workdir',
      taskId: task.id,
    })
  })
})
