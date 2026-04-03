import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const createRoutesMock = vi.fn(() => new Hono())
const createAppRuntimeMock = vi.fn()
const initializeProvidersMock = vi.fn()
const providerManagerInitializeMock = vi.fn()
const bootstrapRuntimeRecoveryMock = vi.fn()
const setSandboxServiceMock = vi.fn()
const setPreviewSandboxServiceMock = vi.fn()
const scheduledTaskSchedulerCtorMock = vi.fn()

const scheduledTaskSchedulerInstance = {
  runNow: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}

vi.mock('../../routes', () => ({
  createRoutes: createRoutesMock,
}))

vi.mock('../app-runtime', () => ({
  createAppRuntime: createAppRuntimeMock,
}))

vi.mock('../../config', () => ({
  getFrontendUrl: () => 'http://localhost:1420',
  logConfig: vi.fn(),
}))

vi.mock('../../core/agent/providers', () => ({
  initializeProviders: initializeProvidersMock,
}))

vi.mock('../../shared/provider/manager', () => ({
  providerManager: {
    initialize: providerManagerInitializeMock,
  },
}))

vi.mock('../../services/approval-coordinator', () => ({
  approvalCoordinator: {
    markPendingAsCanceled: vi.fn(),
    stopLifecycleSweep: vi.fn(),
  },
}))

vi.mock('../../services/plan-store', () => ({
  planStore: {
    stopLifecycleSweep: vi.fn(),
  },
}))

vi.mock('../../services/plan-turn-sync', () => ({
  cancelTurnsForExpiredPlans: vi.fn(),
}))

vi.mock('../../services/runtime-recovery-bootstrap', () => ({
  bootstrapRuntimeRecovery: bootstrapRuntimeRecoveryMock,
}))

vi.mock('../../services/turn-runtime-store', () => ({
  turnRuntimeStore: {},
}))

vi.mock('../../routes/sandbox', () => ({
  setSandboxService: setSandboxServiceMock,
}))

vi.mock('../../routes/preview', () => ({
  setPreviewSandboxService: setPreviewSandboxServiceMock,
}))

vi.mock('../../services/scheduled-task-scheduler', () => ({
  ScheduledTaskScheduler: class ScheduledTaskScheduler {
    constructor(deps: unknown) {
      scheduledTaskSchedulerCtorMock(deps)
      return scheduledTaskSchedulerInstance
    }
  },
}))

describe('API startup composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createAppRuntimeMock.mockReturnValue({
      workDir: '/tmp/easywork-workdir',
      getAgentRuntimeState: vi.fn(() => ({
        agentService: null,
        agentServiceConfig: null,
      })),
      setAgentRuntimeState: vi.fn(),
      getSandboxService: vi.fn(() => null),
      initializeSandboxServices: vi.fn(async () => ({ id: 'sandbox-service' })),
    })
  })

  it('builds routes and scheduler from explicit app runtime deps', async () => {
    await import('../../index')

    expect(createAppRuntimeMock).toHaveBeenCalledTimes(1)
    expect(scheduledTaskSchedulerCtorMock).toHaveBeenCalledTimes(1)
    expect(createRoutesMock).toHaveBeenCalledTimes(1)

    const runtime = createAppRuntimeMock.mock.results[0]?.value
    expect(scheduledTaskSchedulerCtorMock.mock.calls[0]?.[0]).toEqual({
      getAgentRuntimeState: runtime.getAgentRuntimeState,
      workDir: '/tmp/easywork-workdir',
    })
    expect(createRoutesMock.mock.calls[0]?.[0]).toEqual({
      agentNew: {
        getAgentRuntimeState: runtime.getAgentRuntimeState,
        workDir: '/tmp/easywork-workdir',
      },
      settings: {
        getAgentRuntimeState: runtime.getAgentRuntimeState,
        setAgentRuntimeState: runtime.setAgentRuntimeState,
        workDir: '/tmp/easywork-workdir',
      },
      scheduledTasks: {
        getAgentRuntimeState: runtime.getAgentRuntimeState,
        scheduler: scheduledTaskSchedulerInstance,
        workDir: '/tmp/easywork-workdir',
      },
    })
    expect(bootstrapRuntimeRecoveryMock).toHaveBeenCalledTimes(1)
    expect(initializeProvidersMock).toHaveBeenCalledTimes(1)
    expect(providerManagerInitializeMock).toHaveBeenCalledTimes(1)
  })
})
