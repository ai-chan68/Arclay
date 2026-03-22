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
      if (!payload) return { event, data: null }
      try {
        return { event, data: JSON.parse(payload) as Record<string, unknown> }
      } catch {
        return { event, data: null }
      }
    })
}

function getFirstTurnState(events: SseEvent[], expected: string): Record<string, unknown> | null {
  for (const item of events) {
    if (item.event !== 'turn_state' || !item.data) continue
    const turn = item.data.turn
    if (!turn || typeof turn !== 'object') continue
    const state = (turn as Record<string, unknown>).state
    if (state === expected) return turn as Record<string, unknown>
  }
  return null
}

function getFirstTurnStateIndex(events: SseEvent[], expected: string): number {
  return events.findIndex((item) => {
    if (item.event !== 'turn_state' || !item.data) return false
    const turn = item.data.turn
    if (!turn || typeof turn !== 'object') return false
    return (turn as Record<string, unknown>).state === expected
  })
}

describe('V2 Agent Turn Runtime Dependency', () => {
  let app: Hono
  let planStore: {
    getRecord: (planId: string) => { status: string; failReason?: string | null } | null
  }
  let approvalCoordinator: {
    captureQuestionRequest: (
      question: { id: string; question: string; options?: string[]; allowFreeText?: boolean },
      context?: {
        taskId?: string
        runId?: string
        providerSessionId?: string
        source?: 'clarification' | 'runtime_tool_question'
      }
    ) => void
  }
  let oldHome: string | undefined
  let tempHome = ''

  beforeAll(async () => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-agent-v2-turn-runtime-'))
    process.env.HOME = tempHome

    vi.resetModules()
    const routesModule = await import('../agent-new')
    const storeModule = await import('../../services/plan-store')
    const coordinatorModule = await import('../../services/approval-coordinator')
    planStore = storeModule.planStore
    approvalCoordinator = coordinatorModule.approvalCoordinator

    const fakeAgentService = {
      createAgent() {
        return {
          async *plan(prompt: string): AsyncIterable<AgentMessage> {
            yield {
              id: `plan_msg_${Date.now()}`,
              type: 'plan',
              role: 'assistant',
              content: '已生成执行计划',
              timestamp: Date.now(),
              plan: {
                id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                goal: prompt,
                steps: [{ id: 'step_1', description: '执行主步骤', status: 'pending' }],
                createdAt: new Date(),
              },
            }
          },
        }
      },
      async *streamExecution(): AsyncIterable<AgentMessage> {
        yield {
          id: `done_${Date.now()}`,
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

  it('blocks dependent turn until predecessor completes and allows retry by turnId', async () => {
    const taskId = `task_turn_dep_${Date.now()}`

    const firstPlanRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Q1: 先做第一件事',
        taskId,
      }),
    })
    expect(firstPlanRes.status).toBe(200)
    const firstPlanText = await firstPlanRes.text()
    const firstPlanEvents = parseSseEvents(firstPlanText)
    const analyzingTurn = getFirstTurnState(firstPlanEvents, 'analyzing')
    expect(analyzingTurn).not.toBeNull()
    expect(getFirstTurnStateIndex(firstPlanEvents, 'analyzing')).toBeLessThan(
      getFirstTurnStateIndex(firstPlanEvents, 'planning')
    )
    const firstAwaitingTurn = getFirstTurnState(firstPlanEvents, 'awaiting_approval')
    expect(firstAwaitingTurn).not.toBeNull()
    const firstTurnId = String(firstAwaitingTurn?.turnId || '')
    expect(firstTurnId.length).toBeGreaterThan(0)

    const firstPlanEvent = firstPlanEvents.find((event) => event.event === 'plan' && event.data?.plan)
    const firstPlan = firstPlanEvent?.data?.plan as Record<string, unknown> | undefined
    expect(firstPlan).toBeTruthy()
    const firstPlanId = String(firstPlan?.id || '')
    expect(firstPlanId.length).toBeGreaterThan(0)

    const secondPlanRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Q2: 基于 Q1 结果继续',
        taskId,
      }),
    })
    expect(secondPlanRes.status).toBe(200)
    const secondPlanText = await secondPlanRes.text()
    const secondPlanEvents = parseSseEvents(secondPlanText)
    const blockedTurn = getFirstTurnState(secondPlanEvents, 'blocked')
    expect(blockedTurn).not.toBeNull()
    const secondTurnId = String(blockedTurn?.turnId || '')
    expect(secondTurnId.length).toBeGreaterThan(0)
    const blockedBy = Array.isArray(blockedTurn?.blockedByTurnIds)
      ? blockedTurn?.blockedByTurnIds as unknown[]
      : []
    expect(blockedBy).toContain(firstTurnId)
    const blockedTextEvent = secondPlanEvents.find((event) => event.event === 'text' && event.data)
    expect(String(blockedTextEvent?.data?.content || '')).toContain('当前回合正在等待前序回合完成')
    expect(String(blockedTextEvent?.data?.content || '')).not.toContain('Waiting for dependent turns')

    const executeFirstRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: firstPlanId,
        prompt: '执行第一回合',
        taskId,
        turnId: firstTurnId,
      }),
    })
    expect(executeFirstRes.status).toBe(200)
    await executeFirstRes.text()

    const resumeSecondRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Q2: 基于 Q1 结果继续',
        taskId,
        turnId: secondTurnId,
      }),
    })
    expect(resumeSecondRes.status).toBe(200)
    const resumeSecondText = await resumeSecondRes.text()
    const resumeSecondEvents = parseSseEvents(resumeSecondText)
    expect(resumeSecondEvents.some((event) => event.event === 'plan')).toBe(true)
    expect(getFirstTurnState(resumeSecondEvents, 'awaiting_approval')).not.toBeNull()
  })

  it('rejects execute when readVersion mismatches runtime version', async () => {
    const taskId = `task_turn_version_${Date.now()}`
    const planRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '需要版本校验的执行',
        taskId,
      }),
    })
    expect(planRes.status).toBe(200)
    const planText = await planRes.text()
    const planEvents = parseSseEvents(planText)
    const awaitingTurn = getFirstTurnState(planEvents, 'awaiting_approval')
    expect(awaitingTurn).not.toBeNull()
    const turnId = String(awaitingTurn?.turnId || '')
    expect(turnId.length).toBeGreaterThan(0)
    const planEvent = planEvents.find((event) => event.event === 'plan' && event.data?.plan)
    const plan = planEvent?.data?.plan as Record<string, unknown> | undefined
    const planId = String(plan?.id || '')
    expect(planId.length).toBeGreaterThan(0)

    const executeRes = await app.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '执行但版本不匹配',
        taskId,
        turnId,
        readVersion: 9999,
      }),
    })
    expect(executeRes.status).toBe(409)
    const body = await executeRes.json() as { code?: string }
    expect(body.code).toBe('TURN_VERSION_CONFLICT')
    expect(planStore.getRecord(planId)?.status).toBe('orphaned')
    expect(planStore.getRecord(planId)?.failReason).toBe('version_conflict')
  })

  it('cancels the bound turn when execute sees an already expired plan', async () => {
    const taskId = `task_turn_expired_${Date.now()}`
    const planRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '会过期的计划',
        taskId,
      }),
    })
    expect(planRes.status).toBe(200)
    const planText = await planRes.text()
    const planEvents = parseSseEvents(planText)
    const awaitingTurn = getFirstTurnState(planEvents, 'awaiting_approval')
    expect(awaitingTurn).not.toBeNull()
    const turnId = String(awaitingTurn?.turnId || '')
    expect(turnId.length).toBeGreaterThan(0)
    const planEvent = planEvents.find((event) => event.event === 'plan' && event.data?.plan)
    const plan = planEvent?.data?.plan as Record<string, unknown> | undefined
    const planId = String(plan?.id || '')
    expect(planId.length).toBeGreaterThan(0)

    const { planStore } = await import('../../services/plan-store')
    const record = planStore.getRecord(planId)
    expect(record).not.toBeNull()
    if (!record) {
      throw new Error('Expected plan record to exist')
    }

    approvalCoordinator.captureQuestionRequest(
      {
        id: `q_expired_${Date.now()}`,
        question: '过期前留下的澄清问题',
        options: ['继续', '停止'],
        allowFreeText: false,
      },
      {
        taskId,
        runId: record.runId || undefined,
        providerSessionId: record.runId || undefined,
        source: 'clarification',
      }
    )

    const now = Date.now()
    const plansFile = path.join(tempHome, '.easywork', 'plans.json')
    const text = fs.readFileSync(plansFile, 'utf-8')
    const parsed = JSON.parse(text) as { version: number; plans: Array<Record<string, unknown>> }
    parsed.plans = parsed.plans.map((item) => item.id === planId
      ? { ...item, expiresAt: now - 1_000 }
      : item)
    fs.writeFileSync(plansFile, JSON.stringify(parsed, null, 2), 'utf-8')

    vi.resetModules()
    const refreshedPlanStoreModule = await import('../../services/plan-store')
    const refreshedTurnStoreModule = await import('../../services/turn-runtime-store')
    const refreshedRoutesModule = await import('../agent-new')
    refreshedRoutesModule.setAgentService(
      {
        createAgent() {
          return {
            async *plan(): AsyncIterable<AgentMessage> {
              yield {
                id: `unused_${Date.now()}`,
                type: 'done',
                timestamp: Date.now(),
              }
            },
          }
        },
        async *streamExecution(): AsyncIterable<AgentMessage> {
          yield {
            id: `done_${Date.now()}`,
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
    const refreshedApp = new Hono()
    refreshedApp.route('/api/v2/agent', refreshedRoutesModule.agentNewRoutes)

    const executeRes = await refreshedApp.request('/api/v2/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        prompt: '执行过期计划',
        taskId,
        turnId,
      }),
    })
    expect(executeRes.status).toBe(409)

    expect(refreshedPlanStoreModule.planStore.getRecord(planId)?.status).toBe('expired')
    expect(refreshedTurnStoreModule.turnRuntimeStore.getTurn(turnId)?.state).toBe('cancelled')
    expect(refreshedTurnStoreModule.turnRuntimeStore.getTurn(turnId)?.reason).toBe('Plan expired before execution.')

    const pendingRes = await refreshedApp.request(`/api/v2/agent/pending?taskId=${encodeURIComponent(taskId)}`)
    expect(pendingRes.status).toBe(200)
    const pendingBody = await pendingRes.json() as {
      pendingCount?: number
      latestTerminal?: { status?: string; reason?: string | null }
    }
    expect(pendingBody.pendingCount).toBe(0)
    expect(pendingBody.latestTerminal?.status).toBe('canceled')
    expect(pendingBody.latestTerminal?.reason).toBe('Plan expired before execution.')
  })

  it('uses a dedicated runtime session id instead of reusing the client task session id', async () => {
    const taskId = `task_runtime_session_${Date.now()}`
    const clientSessionId = `client_session_${Date.now()}`

    const planRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '验证运行会话隔离',
        taskId,
        sessionId: clientSessionId,
      }),
    })
    expect(planRes.status).toBe(200)
    const planText = await planRes.text()
    const planEvents = parseSseEvents(planText)
    const sessionEvent = planEvents.find((event) => event.event === 'session' && event.data)
    expect(sessionEvent?.data?.sessionId).toBeTruthy()
    expect(sessionEvent?.data?.sessionId).not.toBe(clientSessionId)
  })

  it('keeps pending approvals query-compatible with legacy sessionId filter', async () => {
    const taskId = `task_pending_alias_${Date.now()}`
    const planRes = await app.request('/api/v2/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '请帮我分析整个项目代码和文件结构，并总结整个仓库需要优化的地方',
        taskId,
      }),
    })
    expect(planRes.status).toBe(200)
    const planText = await planRes.text()
    const planEvents = parseSseEvents(planText)
    const sessionEvent = planEvents.find((event) => event.event === 'session' && event.data)
    const runtimeSessionId = String(sessionEvent?.data?.sessionId || '')
    expect(runtimeSessionId.length).toBeGreaterThan(0)

    const pendingRes = await app.request(`/api/v2/agent/pending?sessionId=${encodeURIComponent(runtimeSessionId)}`)
    expect(pendingRes.status).toBe(200)
    const pendingBody = await pendingRes.json() as { pendingCount?: number }
    expect(pendingBody.pendingCount).toBeGreaterThanOrEqual(1)
  })
})
