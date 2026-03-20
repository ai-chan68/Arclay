import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('V2 Agent service readiness', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a structured provider error when planning without an initialized agent service', async () => {
    const { agentNewRoutes, clearAgentService } = await import('../agent-new')
    clearAgentService()

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
})
