import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TaskPlan } from '../../types/agent-new'

interface SseEvent {
  event: string
  data: Record<string, unknown> | null
}

function createPlan(id: string): TaskPlan {
  return {
    id,
    goal: `Goal for ${id}`,
    steps: [
      {
        id: 'step_1',
        description: 'Execute the plan',
        status: 'pending',
      },
    ],
    createdAt: new Date(),
  }
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

describe('V2 Agent Plan Execution', () => {
  let app: Hono
  let routesModule: {
    agentNewRoutes: Hono
    setAgentService: (service: unknown, config: unknown) => void
  }
  let planStore: {
    upsertPendingPlan: (plan: TaskPlan, context?: { taskId?: string; sessionId?: string }) => unknown
    getRecord: (planId: string) => { status: string; failReason?: string | null } | null
  }
  let oldHome: string | undefined
  let tempHome = ''

  beforeAll(async () => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-agent-v2-'))
    process.env.HOME = tempHome

    vi.resetModules()
    routesModule = await import('../agent-new')
    const storeModule = await import('../../services/plan-store')
    planStore = storeModule.planStore

    const fakeAgentService = {
      createAgent() {
        return {}
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 409 conflict when executing the same plan twice', async () => {
    const planId = `plan_exec_${Date.now()}`
    planStore.upsertPendingPlan(createPlan(planId), {
      taskId: 'task_conflict',
      sessionId: 'session_conflict',
    })

    const first = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Run this plan once',
        taskId: 'task_conflict',
      }),
    })
    expect(first.status).toBe(200)
    await first.text()

    const second = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Run this plan twice',
        taskId: 'task_conflict',
      }),
    })
    expect(second.status).toBe(409)
    const body = await second.json() as { code?: string; planStatus?: string }
    expect(body.code).toBe('PLAN_STATE_CONFLICT')
    expect(body.planStatus).toBe('executed')
  })

  it('marks pending plan as rejected via API and prevents execution', async () => {
    const planId = `plan_reject_${Date.now()}`
    planStore.upsertPendingPlan(createPlan(planId), {
      taskId: 'task_reject',
      sessionId: 'session_reject',
    })

    const rejectRes = await app.request('/api/v2/agent/plan/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        reason: 'Rejected from integration test',
      }),
    })
    expect(rejectRes.status).toBe(200)
    const rejectBody = await rejectRes.json() as { success?: boolean; planStatus?: string }
    expect(rejectBody.success).toBe(true)
    expect(rejectBody.planStatus).toBe('rejected')
    expect(planStore.getRecord(planId)?.status).toBe('rejected')
    expect(planStore.getRecord(planId)?.failReason).toBe('approval_rejected')

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'This should be blocked',
        taskId: 'task_reject',
      }),
    })
    expect(executeRes.status).toBe(409)
    const executeBody = await executeRes.json() as { code?: string; planStatus?: string }
    expect(executeBody.code).toBe('PLAN_STATE_CONFLICT')
    expect(executeBody.planStatus).toBe('rejected')
  })

  it('marks executing plan as orphaned when user stops execution', async () => {
    const planId = `plan_abort_${Date.now()}`
    const sessionId = `session_abort_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId: 'task_abort',
      sessionId,
    })

    const longRunningAgentService = {
      createAgent() {
        return {}
      },
      abort() {
        return
      },
      async *streamExecution(): AsyncIterable<AgentMessage> {
        yield {
          id: 'mock_text',
          type: 'text',
          role: 'assistant',
          content: 'running...',
          timestamp: Date.now(),
        }
        await new Promise((resolve) => setTimeout(resolve, 40))
        yield {
          id: 'mock_done_late',
          type: 'done',
          timestamp: Date.now(),
        }
      },
    }

    routesModule.setAgentService(
      longRunningAgentService as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Run and then abort',
        taskId: 'task_abort',
        sessionId,
      }),
    })
    expect(executeRes.status).toBe(200)

    const stopRes = await app.request(`/api/v2/agent/stop/${sessionId}`, {
      method: 'POST',
    })
    expect(stopRes.status).toBe(200)

    await executeRes.text()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')
    expect(planStore.getRecord(planId)?.failReason).toBe('user_cancelled')
  })

  it('bootstraps planning files before execution and preserves them across resume runs', async () => {
    const taskId = `task_planning_files_${Date.now()}`
    const firstPlanId = `plan_bootstrap_1_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(firstPlanId), {
      taskId,
      sessionId: `session_bootstrap_1_${Date.now()}`,
    })

    const firstExecuteRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: firstPlanId,
        prompt: 'Design order management system',
        taskId,
      }),
    })
    expect(firstExecuteRes.status).toBe(200)
    await firstExecuteRes.text()

    const sessionDir = path.join(tempHome, 'sessions', taskId)
    const taskPlanPath = path.join(sessionDir, 'task_plan.md')
    const findingsPath = path.join(sessionDir, 'findings.md')
    const progressPath = path.join(sessionDir, 'progress.md')

    expect(fs.existsSync(taskPlanPath)).toBe(true)
    expect(fs.existsSync(findingsPath)).toBe(true)
    expect(fs.existsSync(progressPath)).toBe(true)

    fs.appendFileSync(taskPlanPath, '\n\nresume-marker', 'utf-8')

    const secondPlanId = `plan_bootstrap_2_${Date.now()}`
    planStore.upsertPendingPlan(createPlan(secondPlanId), {
      taskId,
      sessionId: `session_bootstrap_2_${Date.now()}`,
    })

    const secondExecuteRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: secondPlanId,
        prompt: 'Resume order management system design',
        taskId,
      }),
    })
    expect(secondExecuteRes.status).toBe(200)
    await secondExecuteRes.text()

    const taskPlanContent = fs.readFileSync(taskPlanPath, 'utf-8')
    expect(taskPlanContent).toContain('resume-marker')
  })

  it('appends progress.md when TodoWrite updates are streamed', async () => {
    const taskId = `task_progress_append_${Date.now()}`
    const planId = `plan_progress_append_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_progress_append_${Date.now()}`,
    })

    const todoWriteAgentService = {
      createAgent() {
        return {}
      },
      async *streamExecution(): AsyncIterable<AgentMessage> {
        yield {
          id: 'todo_1',
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: {
            todos: [
              {
                id: '1',
                content: 'Execute the plan',
                status: 'in_progress',
              },
            ],
          },
          timestamp: Date.now(),
        }
        yield {
          id: 'todo_2',
          type: 'tool_use',
          toolName: 'TodoWrite',
          toolInput: {
            todos: [
              {
                id: '1',
                content: 'Execute the plan',
                status: 'completed',
              },
            ],
          },
          timestamp: Date.now(),
        }
        yield {
          id: 'done_progress',
          type: 'done',
          timestamp: Date.now(),
        }
      },
    }

    routesModule.setAgentService(
      todoWriteAgentService as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Track todo progress',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)
    await executeRes.text()

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('Progress Update (')
    expect(progressContent).toContain('Completed: 1/1')
    expect(progressContent).toContain('Execution End (')
  })

  it('persists per-tool audit entries to progress log during execution', async () => {
    const taskId = `task_tool_audit_${Date.now()}`
    const planId = `plan_tool_audit_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_tool_audit_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'tool_use_skill',
            type: 'tool_use',
            toolName: 'Skill',
            toolInput: {
              skill: 'playwright',
              args: '--url https://yx.mail.netease.com/yx-oms#/home',
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_result_skill',
            type: 'tool_result',
            toolOutput: 'Launching skill: playwright',
            timestamp: Date.now(),
          }
          yield {
            id: 'assistant_text_audit',
            type: 'text',
            role: 'assistant',
            content: '正在启动浏览器并准备打开 OMS 页面',
            timestamp: Date.now(),
          }
          yield {
            id: 'done_tool_audit',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Audit tool trace',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)
    await executeRes.text()

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('### Tool Trace (')
    expect(progressContent).toContain('- tool_use Skill')
    expect(progressContent).toContain('skill=playwright')
    expect(progressContent).toContain('- tool_result: Launching skill: playwright')
    expect(progressContent).toContain('- assistant: 正在启动浏览器并准备打开 OMS 页面')
  })

  it('marks plan as orphaned when execution ends with incomplete todos and no final result', async () => {
    const taskId = `task_incomplete_todos_${Date.now()}`
    const planId = `plan_incomplete_todos_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_incomplete_todos_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'todo_incomplete_1',
            type: 'tool_use',
            toolName: 'TodoWrite',
            toolInput: {
              todos: [
                {
                  id: '1',
                  content: 'Execute the plan',
                  status: 'in_progress',
                },
              ],
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_use_browser',
            type: 'tool_use',
            toolName: 'Skill',
            toolInput: {
              skill: 'playwright',
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_result_browser',
            type: 'tool_result',
            toolOutput: 'Launching skill: playwright',
            timestamp: Date.now(),
          }
          yield {
            id: 'done_incomplete',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Use Playwright to query an order and send me the result',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)

    const text = await executeRes.text()
    const events = parseSseEvents(text)
    const errorEvent = events.find((event) => {
      if (event.event !== 'error' || !event.data) return false
      return String(event.data.errorMessage || '').includes('Execution ended before completing all planned steps')
    })

    expect(errorEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('Status: failed')
    expect(progressContent).toContain('Execution ended before completing all planned steps')
  })

  it('pauses execution for user clarification when run is blocked by an interactive step', async () => {
    const taskId = `task_execution_blocked_${Date.now()}`
    const planId = `plan_execution_blocked_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_execution_blocked_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'todo_blocked_1',
            type: 'tool_use',
            toolName: 'TodoWrite',
            toolInput: {
              todos: [
                {
                  id: '1',
                  content: '使用 Playwright 打开网易邮箱订单管理系统',
                  status: 'in_progress',
                },
              ],
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'assistant_blocked_1',
            type: 'text',
            role: 'assistant',
            content: '当前进入网易内部认证系统，需要你先完成登录，完成后回复我继续。',
            timestamp: Date.now(),
          }
          yield {
            id: 'todo_blocked_2',
            type: 'tool_use',
            toolName: 'TodoWrite',
            toolInput: {
              todos: [
                {
                  id: '1',
                  content: '等待用户完成登录认证',
                  status: 'in_progress',
                },
              ],
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'done_blocked',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Use Playwright to query an order and send me the result',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)

    const text = await executeRes.text()
    const events = parseSseEvents(text)
    const clarificationEvent = events.find((event) => {
      if (event.event !== 'clarification_request' || !event.data) return false
      const content = String(event.data.content || '')
      return content.includes('执行被阻塞') && content.includes('登录')
    })
    const errorEvent = events.find((event) => event.event === 'error')

    expect(clarificationEvent).toBeTruthy()
    expect(errorEvent).toBeFalsy()
    expect(planStore.getRecord(planId)?.status).toBe('executing')

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('Status: waiting_for_user')
    expect(progressContent).toContain('登录')
  })

  it('fails execution when provider only emits execution preamble text without starting tools', async () => {
    const taskId = `task_execution_preamble_${Date.now()}`
    const planId = `plan_execution_preamble_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_execution_preamble_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'assistant_preamble_1',
            type: 'text',
            role: 'assistant',
            content: "I'll start by setting up the todo list and then execute the plan step by step.",
            timestamp: Date.now(),
          }
          yield {
            id: 'assistant_preamble_2',
            type: 'text',
            role: 'assistant',
            content: 'Let me navigate to the target page first.',
            timestamp: Date.now() + 1,
          }
          yield {
            id: 'done_preamble',
            type: 'done',
            timestamp: Date.now() + 2,
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Open the page and return the OMS order number',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)

    const text = await executeRes.text()
    const events = parseSseEvents(text)
    const errorEvent = events.find((event) => {
      if (event.event !== 'error' || !event.data) return false
      return String(event.data.errorMessage || '').includes('Execution ended before starting any planned step output')
    })

    expect(errorEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')
  })

  it('fails browser automation execution when it emits only context text without any browser tool usage', async () => {
    const taskId = `task_browser_context_only_${Date.now()}`
    const planId = `plan_browser_context_only_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_browser_context_only_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'assistant_context_only',
            type: 'text',
            role: 'assistant',
            content: '我将立即开始执行任务。首先初始化待办事项列表。I need to clarify my context. The system prompt above is from a different context, but I am operating as a Claude, an AI assistant by Anthropic.',
            timestamp: Date.now(),
          }
          yield {
            id: 'done_context_only',
            type: 'done',
            timestamp: Date.now() + 1,
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '打开https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch，点击订单搜索，获取OMS统一订单号',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)

    const text = await executeRes.text()
    const events = parseSseEvents(text)
    const errorEvent = events.find((event) => {
      if (event.event !== 'error' || !event.data) return false
      return String(event.data.errorMessage || '').includes('Execution ended before starting any browser automation steps')
    })

    expect(errorEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')
  })

  it('uses browser tool evidence instead of assistant text alone to enter waiting_for_user', async () => {
    const taskId = `task_browser_tool_blocker_${Date.now()}`
    const planId = `plan_browser_tool_blocker_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_browser_tool_blocker_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'browser_nav',
            type: 'tool_use',
            toolName: 'mcp__chrome-devtools__navigate_page',
            toolInput: { url: 'https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch' },
            timestamp: Date.now(),
          }
          yield {
            id: 'browser_nav_result',
            type: 'tool_result',
            toolOutput: '[{"type":"text","text":"Successfully navigated to https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch.\\n## Pages\\n1: https://login.netease.com/connect/authorize?response_type=code"}]',
            timestamp: Date.now() + 1,
          }
          yield {
            id: 'assistant_confused',
            type: 'text',
            role: 'assistant',
            content: 'I am Claude, a Claude, an AI assistant by Anthropic. The task is outside my usual context.',
            timestamp: Date.now() + 2,
          }
          yield {
            id: 'done_browser_blocker',
            type: 'done',
            timestamp: Date.now() + 3,
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '打开https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch，点击订单搜索并查询订单',
        taskId,
      }),
    })
    expect(executeRes.status).toBe(200)

    const text = await executeRes.text()
    const events = parseSseEvents(text)
    const clarificationEvent = events.find((event) => event.event === 'clarification_request')
    const errorEvent = events.find((event) => event.event === 'error')

    expect(clarificationEvent).toBeTruthy()
    expect(errorEvent).toBeFalsy()
    expect(planStore.getRecord(planId)?.status).toBe('executing')
  })

  it('auto-retries runtime run intent once and marks plan orphaned when health gate still fails', async () => {
    const planId = `plan_runtime_gate_fail_${Date.now()}`
    let streamCalls = 0

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId: 'task_runtime_gate_fail',
      sessionId: `session_runtime_gate_fail_${Date.now()}`,
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unhealthy', { status: 503 }))

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          streamCalls += 1
          yield {
            id: `tool_use_${streamCalls}`,
            type: 'tool_use',
            toolName: 'sandbox_run_command',
            toolInput: {
              command: 'pnpm',
              args: ['run', 'dev'],
            },
            timestamp: Date.now(),
          }
          yield {
            id: `tool_result_${streamCalls}`,
            type: 'tool_result',
            toolOutput: 'VITE ready at http://localhost:5173/',
            timestamp: Date.now(),
          }
          yield {
            id: `done_${streamCalls}`,
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Run this project frontend and provide preview URL',
        taskId: 'task_runtime_gate_fail',
      }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const events = parseSseEvents(text)
    const autoRepairEvent = events.find((event) => {
      if (event.event !== 'text' || !event.data) return false
      return String(event.data.content || '').includes('开始自动修复')
    })
    const runtimeErrorEvent = events.find((event) => {
      if (event.event !== 'error' || !event.data) return false
      return String(event.data.errorMessage || '').includes('Runtime verification failed')
    })

    expect(streamCalls).toBe(2)
    expect(autoRepairEvent).toBeTruthy()
    expect(runtimeErrorEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')
  })

  it('marks runtime run intent as executed when endpoint health check passes', async () => {
    const planId = `plan_runtime_gate_pass_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId: 'task_runtime_gate_pass',
      sessionId: `session_runtime_gate_pass_${Date.now()}`,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input)
      if (url.includes('127.0.0.1:5173')) {
        return new Response('ok', { status: 200 })
      }
      return new Response('miss', { status: 503 })
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'tool_use_runtime_pass',
            type: 'tool_use',
            toolName: 'sandbox_run_command',
            toolInput: {
              command: 'pnpm',
              args: ['run', 'dev'],
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_result_runtime_pass',
            type: 'tool_result',
            toolOutput: 'Frontend is up at http://localhost:5173/',
            timestamp: Date.now(),
          }
          yield {
            id: 'done_runtime_pass',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Start this project web server and preview it',
        taskId: 'task_runtime_gate_pass',
      }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const events = parseSseEvents(text)
    const runtimeResultEvent = events.find((event) => {
      if (event.event !== 'result' || !event.data) return false
      return String(event.data.content || '').includes('前端预览地址')
    })

    expect(runtimeResultEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('executed')
  })

  it('does not treat EasyWork internal port as project preview inside session workspace', async () => {
    const planId = `plan_runtime_gate_internal_port_${Date.now()}`
    const sessionWorkDir = path.join(tempHome, 'src-api', 'workspace', 'sessions', 'task-runtime-port')
    fs.mkdirSync(sessionWorkDir, { recursive: true })
    let streamCalls = 0

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId: 'task_runtime_gate_internal_port',
      sessionId: `session_runtime_gate_internal_port_${Date.now()}`,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input)
      if (url.includes('127.0.0.1:1420')) {
        return new Response('easywork', { status: 200 })
      }
      return new Response('miss', { status: 503 })
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          streamCalls += 1
          yield {
            id: `tool_use_runtime_internal_${streamCalls}`,
            type: 'tool_use',
            toolName: 'sandbox_run_command',
            toolInput: {
              command: 'pnpm',
              args: ['run', 'dev'],
            },
            timestamp: Date.now(),
          }
          yield {
            id: `tool_result_runtime_internal_${streamCalls}`,
            type: 'tool_result',
            toolOutput: 'Frontend is up at http://localhost:1420/',
            timestamp: Date.now(),
          }
          yield {
            id: `done_runtime_internal_${streamCalls}`,
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Run this project frontend and provide preview URL',
        taskId: 'task_runtime_gate_internal_port',
        workDir: sessionWorkDir,
      }),
    })
    expect(res.status).toBe(200)
    await res.text()

    expect(streamCalls).toBe(2)
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')
  })

  it('does not trigger runtime auto repair for browser automation queries on external pages', async () => {
    const taskId = `task_browser_query_${Date.now()}`
    const planId = `plan_browser_query_${Date.now()}`
    let streamCalls = 0

    planStore.upsertPendingPlan({
      id: planId,
      goal: '访问网易邮箱OMS系统，通过出库批次号查询并获取统一订单号',
      steps: [
        { id: 'step_1', description: '使用web-search技能启动浏览器', status: 'pending' },
        { id: 'step_2', description: '导航到指定的OMS订单搜索页面', status: 'pending' },
        { id: 'step_3', description: '点击查询并提取 OMS统一订单号', status: 'pending' },
      ],
      createdAt: new Date(),
    }, {
      taskId,
      sessionId: `session_browser_query_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          streamCalls += 1
          yield {
            id: 'tool_use_browser_query_skill',
            type: 'tool_use',
            toolName: 'Skill',
            toolInput: {
              skill: 'web-search',
              args: '打开 https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch',
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_result_browser_query_skill',
            type: 'tool_result',
            toolOutput: 'Launching skill: web-search',
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_use_browser_query',
            type: 'tool_use',
            toolName: 'mcp__chrome-devtools__new_page',
            toolInput: {
              url: 'https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch',
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_result_browser_query',
            type: 'tool_result',
            toolOutput: 'Opened OMS page and completed query.',
            timestamp: Date.now(),
          }
          yield {
            id: 'text_browser_query',
            type: 'text',
            role: 'assistant',
            content: '查询结果：OMS统一订单号 645434699',
            timestamp: Date.now(),
          }
          yield {
            id: 'done_browser_query',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '打开https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch,点击单选框"出库批次号",输入Odgsf-20260306-0005205,查询,获取OMS统一订单号',
        taskId,
      }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const events = parseSseEvents(text)
    const autoRepairEvent = events.find((event) => {
      if (event.event !== 'text' || !event.data) return false
      return String(event.data.content || '').includes('开始自动修复')
    })

    expect(autoRepairEvent).toBeFalsy()
    expect(streamCalls).toBe(1)
    expect(planStore.getRecord(planId)?.status).toBe('executed')
  })

  it('marks plan orphaned when execution writes a blocked summary instead of completing the task', async () => {
    const taskId = `task_blocked_summary_${Date.now()}`
    const planId = `plan_blocked_summary_${Date.now()}`

    planStore.upsertPendingPlan(createPlan(planId), {
      taskId,
      sessionId: `session_blocked_summary_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'todo_blocked_summary',
            type: 'tool_use',
            toolName: 'TodoWrite',
            toolInput: {
              todos: [
                {
                  id: '1',
                  content: 'Connect to Feishu MCP',
                  status: 'completed',
                },
              ],
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'write_blocked_summary',
            type: 'tool_use',
            toolName: 'Write',
            toolInput: {
              file_path: path.join(tempHome, 'sessions', taskId, 'task_blocked_summary.md'),
              content: '# Task Execution Blocked',
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'write_blocked_summary_result',
            type: 'tool_result',
            toolOutput: 'File created successfully',
            timestamp: Date.now(),
          }
          yield {
            id: 'done_blocked_summary',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: 'Use Feishu MCP to summarize a document',
        taskId,
      }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    const events = parseSseEvents(text)
    const errorEvent = events.find((event) => event.event === 'error')

    expect(errorEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('Status: failed')
    expect(progressContent).toContain('blocked summary')
  })

  it('marks extraction task orphaned when browser steps finish without any final result text', async () => {
    const taskId = `task_missing_result_${Date.now()}`
    const planId = `plan_missing_result_${Date.now()}`

    planStore.upsertPendingPlan({
      id: planId,
      goal: 'Access NetEase mail system and retrieve OMS order number',
      steps: [
        { id: 'step_1', description: 'Navigate to the NetEase OMS URL', status: 'pending' },
        { id: 'step_2', description: 'Extract the OMS unified order number from results', status: 'pending' },
      ],
      createdAt: new Date(),
    }, {
      taskId,
      sessionId: `session_missing_result_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'tool_use_browser_1',
            type: 'tool_use',
            toolName: 'mcp__chrome-devtools__navigate_page',
            toolInput: {
              url: 'https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch',
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'tool_result_browser_1',
            type: 'tool_result',
            toolOutput: 'Successfully navigated to the order search page',
            timestamp: Date.now(),
          }
          yield {
            id: 'todo_missing_result',
            type: 'tool_use',
            toolName: 'TodoWrite',
            toolInput: {
              todos: [
                { id: '1', content: 'Navigate to the NetEase OMS URL', status: 'completed' },
                { id: '2', content: 'Extract the OMS unified order number from results', status: 'completed' },
              ],
            },
            timestamp: Date.now(),
          }
          yield {
            id: 'done_missing_result',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '打开订单查询页面并获取OMS统一订单号',
        taskId,
      }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    const events = parseSseEvents(text)
    const errorEvent = events.find((event) => {
      if (event.event !== 'error' || !event.data) return false
      return String(event.data.errorMessage || '').includes('final user-visible result')
    })

    expect(errorEvent).toBeTruthy()
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('Status: failed')
    expect(progressContent).toContain('final user-visible result')
  })

  it('treats final text without explicit assistant role as a user-visible result', async () => {
    const taskId = `task_text_without_role_${Date.now()}`
    const planId = `plan_text_without_role_${Date.now()}`

    planStore.upsertPendingPlan({
      id: planId,
      goal: '访问网易邮箱OMS系统，通过出库批次号查询并获取统一订单号',
      steps: [
        { id: 'step_1', description: '执行查询并返回OMS统一订单号', status: 'pending' },
      ],
      createdAt: new Date(),
    }, {
      taskId,
      sessionId: `session_text_without_role_${Date.now()}`,
    })

    routesModule.setAgentService(
      {
        createAgent() {
          return {}
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: 'text_result_without_role',
            type: 'text',
            content: '查询结果：OMS统一订单号 645434699',
            timestamp: Date.now(),
          } as AgentMessage
          yield {
            id: 'done_text_without_role',
            type: 'done',
            timestamp: Date.now(),
          }
        },
      } as any,
      {
        provider: {
          provider: 'claude',
          apiKey: 'test',
          model: 'test-model',
        } as any,
        workDir: tempHome,
      }
    )

    const res = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '获取OMS统一订单号',
        taskId,
      }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    const events = parseSseEvents(text)
    const errorEvent = events.find((event) => event.event === 'error')

    expect(errorEvent).toBeFalsy()
    expect(planStore.getRecord(planId)?.status).toBe('executed')

    const progressPath = path.join(tempHome, 'sessions', taskId, 'progress.md')
    const progressContent = fs.readFileSync(progressPath, 'utf-8')
    expect(progressContent).toContain('- assistant: 查询结果：OMS统一订单号 645434699')
    expect(progressContent).toContain('Status: completed')
  })
})
