import { describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../agent-run-store'
import type { TaskPlan } from '../../types/agent-new'
import type { PlanRecord } from '../../types/plan-store'
import type { TaskRuntimeRecord, TurnArtifactRecord, TurnRecord } from '../../types/turn-runtime'
import { resolvePendingPlanLookupRequest, resolvePlanLookupRequest, resolvePlanRejectRequest, resolveRunStatusRequest, resolveStopSessionRequest, resolveTaskRuntimeRequest, resolveTurnDetailRequest, resolveTurnLookupRequest } from '../runtime-request'

function createRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run_runtime_request',
    phase: 'execute',
    createdAt: new Date('2026-03-22T15:00:00.000Z'),
    isAborted: false,
    abortController: new AbortController(),
    ...overrides,
  }
}

function createPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id: 'plan_runtime_request',
    goal: 'Runtime request plan',
    steps: [],
    createdAt: new Date('2026-03-22T15:00:00.000Z'),
    ...overrides,
  }
}

function createPlanRecord(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan_runtime_request',
    taskId: 'task_runtime_request',
    runId: 'run_runtime_request',
    turnId: 'turn_runtime_request',
    status: 'rejected',
    failReason: 'approval_rejected',
    plan: {
      id: 'plan_runtime_request',
      goal: 'Runtime request plan',
      steps: [],
      createdAt: Date.parse('2026-03-22T15:00:00.000Z'),
    },
    createdAt: Date.parse('2026-03-22T15:00:00.000Z'),
    updatedAt: Date.parse('2026-03-22T15:00:00.000Z'),
    expiresAt: Date.parse('2026-03-23T15:00:00.000Z'),
    executedAt: null,
    reason: 'Rejected from request service',
    ...overrides,
  }
}

function createRuntime(overrides: Partial<TaskRuntimeRecord> = {}): TaskRuntimeRecord {
  return {
    taskId: 'task_runtime_request',
    version: 3,
    status: 'running',
    activeTurnId: 'turn_runtime_request',
    updatedAt: 1,
    ...overrides,
  }
}

function createTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: 'turn_runtime_request',
    taskId: 'task_runtime_request',
    runId: 'run_runtime_request',
    prompt: 'runtime request',
    state: 'executing',
    readVersion: 1,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('runtime-request', () => {
  it('maps stop-session outcomes to HTTP payloads', () => {
    const stopped = resolveStopSessionRequest({
      sessionId: 'run_runtime_request',
      stopAgentSession: vi.fn(() => ({
        status: 'stopped',
        source: 'active_run',
        turnId: 'turn_runtime_request',
      })),
    })
    expect(stopped).toEqual({
      statusCode: 200,
      body: {
        success: true,
      },
    })

    const missing = resolveStopSessionRequest({
      sessionId: 'missing_run',
      stopAgentSession: vi.fn(() => ({
        status: 'not_found',
        source: null,
        turnId: null,
      })),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        success: false,
        error: 'Session not found',
      },
    })
  })

  it('builds run status response and handles missing sessions', () => {
    const ready = resolveRunStatusRequest({
      sessionId: 'run_runtime_request',
      getRun: vi.fn(() => createRun()),
    })
    expect(ready).toEqual({
      statusCode: 200,
      body: {
        id: 'run_runtime_request',
        phase: 'execute',
        isAborted: false,
        createdAt: new Date('2026-03-22T15:00:00.000Z'),
      },
    })

    const missing = resolveRunStatusRequest({
      sessionId: 'missing_run',
      getRun: vi.fn(() => null),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        error: 'Session not found',
      },
    })
  })

  it('looks up plans with canonical 404 mapping', () => {
    const ready = resolvePlanLookupRequest({
      planId: 'plan_runtime_request',
      getPlan: vi.fn(() => createPlan()),
    })
    expect(ready.statusCode).toBe(200)
    expect(ready.body).toEqual(createPlan())

    const missing = resolvePlanLookupRequest({
      planId: 'missing_plan',
      getPlan: vi.fn(() => null),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        error: 'Plan not found',
      },
    })
  })

  it('looks up pending plans by task/turn for approval-state recovery', () => {
    const ready = resolvePendingPlanLookupRequest({
      taskId: 'task_runtime_request',
      turnId: 'turn_runtime_request',
      getPendingPlan: vi.fn(() => createPlan()),
    })
    expect(ready.statusCode).toBe(200)
    expect(ready.body).toEqual(createPlan())

    const invalid = resolvePendingPlanLookupRequest({
      taskId: '',
      turnId: 'turn_runtime_request',
      getPendingPlan: vi.fn(),
    })
    expect(invalid).toEqual({
      statusCode: 400,
      body: {
        error: 'taskId is required',
      },
    })

    const missing = resolvePendingPlanLookupRequest({
      taskId: 'task_runtime_request',
      turnId: 'turn_runtime_request',
      getPendingPlan: vi.fn(() => null),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        error: 'Pending plan not found',
      },
    })
  })

  it('builds task runtime snapshot and validates taskId presence', () => {
    const artifacts: TurnArtifactRecord[] = [
      {
        turnId: 'turn_runtime_request',
        taskId: 'task_runtime_request',
        kind: 'result',
        content: 'done',
        createdAt: 1,
      },
    ]
    const sessionDocs = [
      {
        id: 'session-doc-history-jsonl',
        name: 'history.jsonl',
        path: '/tmp/task_runtime_request/history.jsonl',
        type: 'text',
      },
      {
        id: 'session-doc-task-plan-md',
        name: 'task_plan.md',
        path: '/tmp/task_runtime_request/task_plan.md',
        type: 'markdown',
      },
      {
        id: 'session-doc-progress-md',
        name: 'progress.md',
        path: '/tmp/task_runtime_request/progress.md',
        type: 'markdown',
      },
      {
        id: 'session-doc-findings-md',
        name: 'findings.md',
        path: '/tmp/task_runtime_request/findings.md',
        type: 'markdown',
      },
    ]

    const ready = resolveTaskRuntimeRequest({
      taskId: 'task_runtime_request',
      getRuntime: vi.fn(() => createRuntime()),
      listTurns: vi.fn(() => [createTurn()]),
      listArtifacts: vi.fn(() => artifacts),
      listSessionDocuments: vi.fn(() => sessionDocs),
    })
    expect(ready).toEqual({
      statusCode: 200,
      body: {
        taskId: 'task_runtime_request',
        runtime: createRuntime(),
        turns: [createTurn()],
        artifacts,
        sessionDocs,
      },
    })

    const invalid = resolveTaskRuntimeRequest({
      taskId: '',
      getRuntime: vi.fn(),
      listTurns: vi.fn(),
      listArtifacts: vi.fn(),
      listSessionDocuments: vi.fn(),
    })
    expect(invalid).toEqual({
      statusCode: 400,
      body: {
        error: 'taskId is required',
      },
    })
  })

  it('builds turn lookup response and preserves runtime snapshot', () => {
    const ready = resolveTurnLookupRequest({
      turnId: 'turn_runtime_request',
      getTurn: vi.fn(() => createTurn()),
      getRuntime: vi.fn(() => createRuntime()),
    })
    expect(ready).toEqual({
      statusCode: 200,
      body: {
        turn: createTurn(),
        runtime: createRuntime(),
      },
    })

    const missing = resolveTurnLookupRequest({
      turnId: 'missing_turn',
      getTurn: vi.fn(() => null),
      getRuntime: vi.fn(),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        error: 'Turn not found',
      },
    })
  })

  it('builds turn detail response and preserves persisted detail payload', () => {
    const detail = {
      taskId: 'task_runtime_request',
      turn: createTurn(),
      summaryText: '导出 PDF',
      planSnapshot: null,
      output: {
        textPath: '/tmp/task_runtime_request/turns/turn_runtime_request/output.md',
        text: '最终输出',
        artifacts: [
          {
            id: 'artifact_1',
            name: 'report.pdf',
            path: '/tmp/task_runtime_request/report.pdf',
            type: 'pdf',
          },
        ],
        primaryArtifactId: 'artifact_1',
      },
      updatedAt: '2026-03-26T00:00:00.000Z',
    }

    const ready = resolveTurnDetailRequest({
      turnId: 'turn_runtime_request',
      getTurn: vi.fn(() => createTurn()),
      getRuntime: vi.fn(() => createRuntime()),
      loadTurnDetail: vi.fn(() => detail),
    })
    expect(ready).toEqual({
      statusCode: 200,
      body: {
        turn: createTurn(),
        runtime: createRuntime(),
        detail,
      },
    })

    const missing = resolveTurnDetailRequest({
      turnId: 'turn_runtime_request',
      getTurn: vi.fn(() => createTurn()),
      getRuntime: vi.fn(() => createRuntime()),
      loadTurnDetail: vi.fn(() => null),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        error: 'Turn detail not found',
      },
    })
  })

  it('maps plan reject validation and success responses', () => {
    const invalid = resolvePlanRejectRequest({
      body: {},
      rejectPendingPlan: vi.fn(),
    })
    expect(invalid).toEqual({
      statusCode: 400,
      body: {
        error: 'planId is required',
      },
    })

    const ready = resolvePlanRejectRequest({
      body: {
        planId: 'plan_runtime_request',
        reason: 'Rejected from request service',
      },
      rejectPendingPlan: vi.fn(() => ({
        status: 'rejected',
        record: createPlanRecord(),
      })),
    })
    expect(ready).toEqual({
      statusCode: 200,
      body: {
        success: true,
        planId: 'plan_runtime_request',
        planStatus: 'rejected',
      },
    })

    const missing = resolvePlanRejectRequest({
      body: {
        planId: 'missing_plan',
      },
      rejectPendingPlan: vi.fn(() => ({
        status: 'not_found',
      })),
    })
    expect(missing).toEqual({
      statusCode: 404,
      body: {
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND',
      },
    })
  })
})
