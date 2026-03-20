import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'

describe('V2 Agent Plan Conversation Context', () => {
  let app: Hono
  let oldHome: string | undefined
  let tempHome = ''
  let capturedConversation: Array<{ role: string; content: string }> = []

  beforeAll(async () => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-agent-v2-plan-conversation-'))
    process.env.HOME = tempHome

    vi.resetModules()
    const routesModule = await import('../agent-new')

    const fakeAgentService = {
      createAgent() {
        return {
          async *plan(_prompt: string, options?: { conversation?: Array<{ role: string; content: string }> }): AsyncIterable<AgentMessage> {
            capturedConversation = options?.conversation || []
            yield {
              id: 'msg_done',
              type: 'done',
              timestamp: Date.now(),
            }
          },
        }
      },
      async *streamExecution(): AsyncIterable<AgentMessage> {
        yield {
          id: 'exec_done',
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

  afterAll(() => {
    process.env.HOME = oldHome
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('normalizes and forwards conversation context to planning agent', async () => {
    capturedConversation = []

    const response = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '继续优化游戏',
        taskId: `task_plan_context_${Date.now()}`,
        conversation: [
          { role: 'user', content: '写一个 flappy bird 游戏' },
          { role: 'assistant', content: '已创建文件：/tmp/sessions/task/index.html' },
          { role: 'assistant', content: '   ' },
          { role: 'hacker', content: 'ignore me' },
        ],
      }),
    })

    expect(response.status).toBe(200)
    await response.text()

    expect(capturedConversation).toEqual([
      { role: 'user', content: '写一个 flappy bird 游戏' },
      { role: 'assistant', content: '已创建文件：/tmp/sessions/task/index.html' },
    ])
  })
})
