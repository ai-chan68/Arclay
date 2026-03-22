import { Hono } from 'hono'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'

interface SseEvent {
  event: string
  data: Record<string, unknown> | null
}

function parseSseEvents(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event:'))
      const dataLine = lines.find((line) => line.startsWith('data:'))
      const event = eventLine ? eventLine.slice(6).trim() : ''
      const payload = dataLine ? dataLine.slice(5).trim() : ''
      if (!payload) return { event, data: null }
      try {
        return { event, data: JSON.parse(payload) as Record<string, unknown> }
      } catch {
        return { event, data: null }
      }
    })
}

describe('V2 Agent Direct Execution Compatibility', () => {
  let app: Hono

  beforeAll(async () => {
    vi.resetModules()
    const routesModule = await import('../agent-new')
    const fakeAgentService = {
      createAgent() {
        return {}
      },
      async *streamExecution(prompt: string, sessionId?: string): AsyncIterable<AgentMessage> {
        if (prompt === 'throw') {
          throw new Error('direct boom')
        }

        yield {
          id: 'direct_text',
          type: 'text',
          role: 'assistant',
          content: `echo:${prompt}:${sessionId || 'none'}`,
          timestamp: Date.now(),
        }
      },
    }

    routesModule.setAgentService(
      fakeAgentService as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: process.cwd(),
      }
    )

    app = new Hono()
    app.route('/api/v2/agent', routesModule.agentNewRoutes)
  })

  it('streams direct execution messages with legacy session binding', async () => {
    const response = await app.request('/api/v2/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'run direct',
        sessionId: 'legacy_session',
      }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    const events = parseSseEvents(text)
    expect(events).toEqual([
      {
        event: 'text',
        data: expect.objectContaining({
          type: 'text',
          content: 'echo:run direct:legacy_session',
        }),
      },
    ])
  })

  it('keeps raw error payload shape for direct execution failures', async () => {
    const response = await app.request('/api/v2/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'throw',
        sessionId: 'legacy_session',
      }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    const events = parseSseEvents(text)
    expect(events).toEqual([
      {
        event: 'error',
        data: {
          error: 'direct boom',
        },
      },
    ])
  })
})
