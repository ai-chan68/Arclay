import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

      if (!payload) {
        return { event, data: null }
      }

      try {
        return { event, data: JSON.parse(payload) as Record<string, unknown> }
      } catch {
        return { event, data: null }
      }
    })
}

describe('V2 Agent Preflight Clarification Guard', () => {
  let app: Hono
  let planSpy: ReturnType<typeof vi.fn>
  let oldHome: string | undefined
  let tempHome = ''

  beforeAll(async () => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-agent-v2-preflight-'))
    process.env.HOME = tempHome

    vi.resetModules()
    const routesModule = await import('../agent-new')

    planSpy = vi.fn((_prompt?: string) => (async function* (): AsyncIterable<AgentMessage> {
      yield {
        id: `plan_${Date.now()}`,
        type: 'plan',
        role: 'assistant',
        content: '已生成执行计划',
        timestamp: Date.now(),
        plan: {
          id: `plan_data_${Date.now()}`,
          goal: '测试计划',
          steps: [{ id: 'step_1', description: '执行测试', status: 'pending' }],
          createdAt: new Date(),
        },
      } as AgentMessage
    })())

    const fakeAgentService = {
      createAgent() {
        return {
          plan: planSpy,
        }
      },
      async *streamExecution(): AsyncIterable<AgentMessage> {
        yield {
          id: 'mock_done',
          type: 'done',
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
        workDir: tempHome,
      }
    )

    app = new Hono()
    app.route('/api/v2/agent', routesModule.agentNewRoutes)
  })

  beforeEach(() => {
    planSpy.mockClear()
  })

  afterAll(() => {
    process.env.HOME = oldHome
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('asks clarification before planning when project path is missing', async () => {
    const taskId = `task_preflight_clarify_${Date.now()}`
    const response = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '读取项目代码并总结最近最值得优化的 5 个点',
        taskId,
      }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    const events = parseSseEvents(text)

    expect(events.some((event) => event.event === 'clarification_request')).toBe(true)
    expect(events.some((event) => event.event === 'plan')).toBe(false)
    expect(planSpy).not.toHaveBeenCalled()
  })

  it('continues planning when prompt includes explicit project target', async () => {
    const taskId = `task_preflight_plan_${Date.now()}`
    const response = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '读取 /workspace/easeWork 项目代码并总结最近最值得优化的 5 个点',
        taskId,
      }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    const events = parseSseEvents(text)

    expect(events.some((event) => event.event === 'plan')).toBe(true)
    expect(events.some((event) => event.event === 'clarification_request')).toBe(false)
    expect(planSpy).toHaveBeenCalledTimes(1)
  })
})
