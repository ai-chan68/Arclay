import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAgentServiceMock = vi.fn(() => ({ id: 'agent-service' }))
const createSandboxServiceMock = vi.fn(async () => ({ id: 'sandbox-service' }))

let activeProvider: {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
} | null = null

let fallbackProviderConfig: {
  provider: 'claude' | 'glm' | 'openai' | 'openrouter' | 'kimi' | 'deepseek'
  apiKey: string
  model: string
  baseUrl?: string
} = {
  provider: 'claude',
  apiKey: '',
  model: 'claude-sonnet-4-5',
}

vi.mock('../../services/agent-service', async () => {
  const actual = await vi.importActual<typeof import('../../services/agent-service')>('../../services/agent-service')
  return {
    ...actual,
    createAgentService: createAgentServiceMock,
  }
})

vi.mock('../../core/sandbox/sandbox-service', async () => {
  const actual = await vi.importActual<typeof import('../../core/sandbox/sandbox-service')>('../../core/sandbox/sandbox-service')
  return {
    ...actual,
    createSandboxService: createSandboxServiceMock,
  }
})

vi.mock('../../settings-store', () => ({
  getSettings: () => ({
    skills: { enabled: true },
    sandbox: { enabled: false },
  }),
  getActiveProviderConfig: () => activeProvider,
  normalizeSandboxSettings: () => ({ enabled: false, provider: 'native' }),
}))

vi.mock('../../config', () => ({
  getProviderConfig: () => fallbackProviderConfig,
  getWorkDir: () => '/tmp/arclay-workdir',
}))

describe('createAppRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    activeProvider = null
    fallbackProviderConfig = {
      provider: 'claude',
      apiKey: '',
      model: 'claude-sonnet-4-5',
    }
  })

  it('returns empty runtime state when no provider is configured', async () => {
    const { createAppRuntime } = await import('../app-runtime')
    const runtime = await createAppRuntime()

    expect(runtime.getAgentRuntimeState()).toEqual({
      agentService: null,
      agentServiceConfig: null,
    })
    expect(createAgentServiceMock).not.toHaveBeenCalled()
  })

  it('builds runtime state from active provider settings', async () => {
    activeProvider = {
      provider: 'claude',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-5',
      baseUrl: 'https://example.com',
    }

    const { createAppRuntime } = await import('../app-runtime')
    const runtime = await createAppRuntime()
    const runtimeState = runtime.getAgentRuntimeState()

    expect(runtimeState.agentService).toEqual({ id: 'agent-service' })
    expect(runtimeState.agentServiceConfig?.provider).toEqual({
      provider: 'claude',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-5',
      baseUrl: 'https://example.com',
    })
    expect(createAgentServiceMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to environment provider config when no active provider is saved', async () => {
    fallbackProviderConfig = {
      provider: 'openai',
      apiKey: 'env-test-key',
      model: 'gpt-4.1',
      baseUrl: 'https://env.example.com',
    }

    const { createAppRuntime } = await import('../app-runtime')
    const runtime = await createAppRuntime()

    expect(runtime.getAgentRuntimeState().agentService).toEqual({ id: 'agent-service' })
    expect(runtime.getAgentRuntimeState().agentServiceConfig?.provider).toEqual({
      provider: 'openai',
      apiKey: 'env-test-key',
      model: 'gpt-4.1',
      baseUrl: 'https://env.example.com',
    })
    expect(createAgentServiceMock).toHaveBeenCalledTimes(1)
  })

  it('initializes sandbox service once per runtime instance', async () => {
    const { createAppRuntime } = await import('../app-runtime')
    const runtime = await createAppRuntime()

    await Promise.all([
      runtime.initializeSandboxServices(),
      runtime.initializeSandboxServices(),
    ])

    expect(createSandboxServiceMock).toHaveBeenCalledTimes(1)
    expect(createSandboxServiceMock).toHaveBeenCalledWith('/tmp/arclay-workdir')
    expect(runtime.getSandboxService()).toEqual({ id: 'sandbox-service' })
  })

  it('allows sandbox initialization to retry after a failure', async () => {
    createSandboxServiceMock
      .mockRejectedValueOnce(new Error('temporary sandbox failure'))
      .mockResolvedValueOnce({ id: 'sandbox-service-retry' })

    const { createAppRuntime } = await import('../app-runtime')
    const runtime = await createAppRuntime()

    await expect(runtime.initializeSandboxServices()).rejects.toThrow('temporary sandbox failure')
    await expect(runtime.initializeSandboxServices()).resolves.toEqual({ id: 'sandbox-service-retry' })

    expect(createSandboxServiceMock).toHaveBeenCalledTimes(2)
    expect(runtime.getSandboxService()).toEqual({ id: 'sandbox-service-retry' })
  })
})
