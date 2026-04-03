import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('V2 Agent service readiness', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('requires explicit runtime deps when composing all routes', async () => {
    const { createRoutes } = await import('../index')

    expect(() => createRoutes()).toThrow(/explicit route deps/i)
  })

  it('returns a structured provider error when planning without an initialized agent service', async () => {
    const { createAgentNewRoutes } = await import('../agent-new')
    const agentNewRoutes = createAgentNewRoutes({
      workDir: process.cwd(),
      getAgentRuntimeState: () => ({
        agentService: null,
        agentServiceConfig: null,
      }),
    })

    const res = await agentNewRoutes.request('/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '整理今天的工作计划',
      }),
    })

    expect(res.status).toBe(500)

    const body = await res.json() as { error?: string; code?: string }
    expect(body.code).toBe('PROVIDER_ERROR')
    expect(body.error).toContain('Provider')
  })

  it('wires v2 agent routes through createRoutes with the same unavailable response', async () => {
    const { createRoutes } = await import('../index')
    const routes = createRoutes({
      agentNew: {
        workDir: process.cwd(),
        getAgentRuntimeState: () => ({
          agentService: null,
          agentServiceConfig: null,
        }),
      },
      settings: {
        workDir: process.cwd(),
        getAgentRuntimeState: () => ({
          agentService: null,
          agentServiceConfig: null,
        }),
        setAgentRuntimeState: vi.fn(),
      },
      scheduledTasks: {
        workDir: process.cwd(),
        getAgentRuntimeState: () => ({
          agentService: null,
          agentServiceConfig: null,
        }),
        scheduler: {
          runNow: vi.fn(),
        },
      },
    })

    const res = await routes.request('/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '整理今天的工作计划',
      }),
    })

    expect(res.status).toBe(500)

    const body = await res.json() as { error?: string; code?: string }
    expect(body.code).toBe('PROVIDER_ERROR')
    expect(body.error).toContain('Provider')
  })
})
