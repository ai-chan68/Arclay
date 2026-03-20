import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

describe('V2 Agent Clarification Flow', () => {
  let app: Hono
  let approvalCoordinator: {
    captureQuestionRequest: (
      question: { id: string; question: string; options?: string[]; allowFreeText?: boolean },
      context?: { taskId?: string; source?: 'clarification' | 'runtime_tool_question'; round?: number }
    ) => void
  }
  let oldHome: string | undefined
  let tempHome = ''

  beforeAll(async () => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-agent-v2-clarification-'))
    process.env.HOME = tempHome

    vi.resetModules()
    const routesModule = await import('../agent-new')
    const coordinatorModule = await import('../../services/approval-coordinator')
    approvalCoordinator = coordinatorModule.approvalCoordinator

    const fakeAgentService = {
      createAgent() {
        return {
          async *plan(): AsyncIterable<AgentMessage> {
            yield {
              id: `clarify_${Date.now()}`,
              type: 'clarification_request',
              role: 'assistant',
              content: 'Need clarification',
              clarification: {
                id: `q_${Date.now()}`,
                question: '请选择输出格式',
                options: ['Markdown', 'JSON'],
                allowFreeText: true,
              },
              question: {
                id: `q_${Date.now()}_legacy`,
                question: '请选择输出格式',
                options: ['Markdown', 'JSON'],
                allowFreeText: true,
              },
              timestamp: Date.now(),
            }
          },
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

  afterAll(() => {
    process.env.HOME = oldHome
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('enforces maxClarificationRounds per task and emits error when exceeded', async () => {
    const taskId = `task_clarification_limit_${Date.now()}`

    const first = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Do something ambiguous',
        taskId,
        maxClarificationRounds: 1,
      }),
    })
    expect(first.status).toBe(200)
    const firstText = await first.text()
    const firstEvents = parseSseEvents(firstText)
    expect(firstEvents.some((event) => event.event === 'clarification_request')).toBe(true)

    const second = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Do something ambiguous',
        taskId,
        maxClarificationRounds: 1,
      }),
    })
    expect(second.status).toBe(200)
    const secondText = await second.text()
    const secondEvents = parseSseEvents(secondText)
    const errorEvent = secondEvents.find((event) => event.event === 'error')
    expect(errorEvent?.data?.errorMessage).toContain('澄清轮次超过上限（1）')
  })

  it('returns nextAction in /question response by source', async () => {
    const taskId = `task_clarification_action_${Date.now()}`
    const questionId = `q_clarification_${Date.now()}`
    const runtimeQuestionId = `q_runtime_${Date.now()}`

    approvalCoordinator.captureQuestionRequest(
      {
        id: questionId,
        question: '澄清一下目标格式',
        options: ['A', 'B'],
        allowFreeText: true,
      },
      {
        taskId,
        source: 'clarification',
        round: 1,
      }
    )

    const clarificationReply = await app.request('/api/v2/agent/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId,
        answers: { selected: 'A' },
      }),
    })
    expect(clarificationReply.status).toBe(200)
    const clarificationBody = await clarificationReply.json() as { nextAction?: string }
    expect(clarificationBody.nextAction).toBe('resume_planning')

    approvalCoordinator.captureQuestionRequest(
      {
        id: runtimeQuestionId,
        question: '是否继续执行？',
        options: ['继续', '停止'],
        allowFreeText: false,
      },
      {
        taskId,
        source: 'runtime_tool_question',
      }
    )

    const runtimeReply = await app.request('/api/v2/agent/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: runtimeQuestionId,
        answers: { selected: '继续' },
      }),
    })
    expect(runtimeReply.status).toBe(200)
    const runtimeBody = await runtimeReply.json() as { nextAction?: string }
    expect(runtimeBody.nextAction).toBe('resume_execution')
  })

  it('includes question source metadata in /pending response', async () => {
    const taskId = `task_clarification_pending_${Date.now()}`
    const questionId = `q_pending_${Date.now()}`

    approvalCoordinator.captureQuestionRequest(
      {
        id: questionId,
        question: '请澄清输出格式',
        options: ['Markdown', 'JSON'],
        allowFreeText: true,
      },
      {
        taskId,
        source: 'clarification',
        round: 2,
      }
    )

    const pendingReply = await app.request(`/api/v2/agent/pending?taskId=${encodeURIComponent(taskId)}`)
    expect(pendingReply.status).toBe(200)
    const body = await pendingReply.json() as {
      pendingQuestions?: Array<{ id: string; source?: string; round?: number }>
    }
    const pending = Array.isArray(body.pendingQuestions) ? body.pendingQuestions : []
    const target = pending.find((item) => item.id === questionId)
    expect(target?.source).toBe('clarification')
    expect(target?.round).toBe(2)
  })
})
