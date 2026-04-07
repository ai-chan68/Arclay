import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { TaskPlan } from '../../types/agent-new'
import type { PlanRecord } from '../../types/plan-store'
import type { TurnRecord } from '../../types/turn-runtime'
import { prepareExecutionStart } from '../execution-start'

function createPlan(id = 'plan_exec_start'): TaskPlan {
  return {
    id,
    goal: 'Execute the plan',
    steps: [
      {
        id: 'step_1',
        description: 'Run the plan',
        status: 'pending',
      },
    ],
    createdAt: new Date('2026-03-22T12:00:00.000Z'),
  }
}

function createPlanRecord(
  overrides: Partial<PlanRecord> = {}
): PlanRecord {
  return {
    id: 'plan_exec_start',
    taskId: 'task_exec_start',
    runId: 'run_old',
    turnId: 'turn_exec_start',
    status: 'pending_approval',
    failReason: null,
    plan: {
      id: 'plan_exec_start',
      goal: 'Execute the plan',
      steps: [
        {
          id: 'step_1',
          description: 'Run the plan',
          status: 'pending',
        },
      ],
      createdAt: Date.parse('2026-03-22T12:00:00.000Z'),
    },
    createdAt: Date.parse('2026-03-22T12:00:00.000Z'),
    updatedAt: Date.parse('2026-03-22T12:00:00.000Z'),
    expiresAt: Date.parse('2026-03-23T12:00:00.000Z'),
    executedAt: null,
    reason: null,
    ...overrides,
  }
}

function createTurn(
  overrides: Partial<TurnRecord> = {}
): TurnRecord {
  return {
    id: 'turn_exec_start',
    taskId: 'task_exec_start',
    runId: 'run_old',
    prompt: 'Execute the plan',
    state: 'awaiting_approval',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('prepareExecutionStart', () => {
  it('returns not_found when the plan record does not exist', async () => {
    const result = await prepareExecutionStart({
      planId: 'missing_plan',
      prompt: 'Run this',
      runId: 'run_exec',
      requestedTaskId: undefined,
      requestedTurnId: undefined,
      requestedReadVersion: undefined,
      requestedWorkDir: undefined,
      defaultWorkDir: '/workspace',
      getPlanRecord: () => null,
      getTurn: vi.fn(),
      findLatestTurnByTask: vi.fn(),
      startPlanExecution: vi.fn(() => ({ status: 'not_found' })),
      cancelExpiredPlanTurns: vi.fn(),
      startTurnExecution: vi.fn(),
      markPlanOrphaned: vi.fn(),
      bootstrapPlanningFiles: vi.fn(),
    })

    expect(result.status).toBe('not_found')
  })

  it('cancels expired bound turns when the plan is already expired', async () => {
    const expiredRecord = createPlanRecord({
      status: 'expired',
      failReason: 'approval_timeout',
      reason: 'Plan expired before execution.',
    })
    const cancelExpiredPlanTurns = vi.fn()

    const result = await prepareExecutionStart({
      planId: 'plan_exec_start',
      prompt: 'Run this',
      runId: 'run_exec',
      requestedTaskId: undefined,
      requestedTurnId: undefined,
      requestedReadVersion: undefined,
      requestedWorkDir: undefined,
      defaultWorkDir: '/workspace',
      getPlanRecord: () => expiredRecord,
      getTurn: vi.fn(),
      findLatestTurnByTask: vi.fn(),
      startPlanExecution: vi.fn(() => ({ status: 'conflict', record: expiredRecord })),
      cancelExpiredPlanTurns,
      startTurnExecution: vi.fn(),
      markPlanOrphaned: vi.fn(),
      bootstrapPlanningFiles: vi.fn(),
    })

    expect(result.status).toBe('plan_conflict')
    expect(result.planStatus).toBe('expired')
    expect(cancelExpiredPlanTurns).toHaveBeenCalledWith([expiredRecord])
  })

  it('marks the plan orphaned when the bound turn cannot enter execution', async () => {
    const plan = createPlan()
    const awaitingApprovalTurn = createTurn()
    const markPlanOrphaned = vi.fn()
    const orphanPendingApprovals = vi.fn()

    const result = await prepareExecutionStart({
      planId: 'plan_exec_start',
      prompt: 'Run this',
      runId: 'run_exec',
      requestedTaskId: 'task_exec_start',
      requestedTurnId: 'turn_exec_start',
      requestedReadVersion: 3,
      requestedWorkDir: '/workspace',
      defaultWorkDir: '/workspace',
      getPlanRecord: () => createPlanRecord(),
      getTurn: () => awaitingApprovalTurn,
      findLatestTurnByTask: vi.fn(),
      startPlanExecution: vi.fn(() => ({ status: 'ok', record: createPlanRecord({ status: 'executing' }), plan })),
      cancelExpiredPlanTurns: vi.fn(),
      startTurnExecution: vi.fn(() => ({
        status: 'conflict',
        code: 'TURN_VERSION_CONFLICT',
        turn: awaitingApprovalTurn,
        runtime: {
          taskId: 'task_exec_start',
          version: 7,
          status: 'awaiting',
          activeTurnId: 'turn_exec_start',
          updatedAt: 1,
        },
        reason: 'Task version mismatch: expected 3, actual 7.',
      })),
      markPlanOrphaned,
      orphanPendingApprovals,
      bootstrapPlanningFiles: vi.fn(),
    })

    expect(result.status).toBe('turn_conflict')
    expect(result.code).toBe('TURN_VERSION_CONFLICT')
    expect(result.turnState).toBe('awaiting_approval')
    expect(result.taskVersion).toBe(7)
    expect(markPlanOrphaned).toHaveBeenCalledWith(
      'plan_exec_start',
      'Task version mismatch: expected 3, actual 7.',
      'version_conflict'
    )
    expect(orphanPendingApprovals).toHaveBeenCalledWith({
      taskId: 'task_exec_start',
      runId: 'run_exec',
      providerSessionId: 'run_exec',
    }, 'Task version mismatch: expected 3, actual 7.')
  })

  it('returns ready with bootstrapped workspace and resolved turn context', async () => {
    const plan = createPlan()
    const awaitingApprovalTurn = createTurn()
    const executingTurn = { ...awaitingApprovalTurn, state: 'executing' as const }
    const bootstrapPlanningFiles = vi.fn(async () => ({
      sessionDir: '/workspace/sessions/task_exec_start',
      createdFiles: ['task_plan.md'],
      skippedFiles: ['progress.md'],
    }))

    const result = await prepareExecutionStart({
      planId: 'plan_exec_start',
      prompt: 'Run this',
      runId: 'run_exec',
      requestedTaskId: undefined,
      requestedTurnId: undefined,
      requestedReadVersion: undefined,
      requestedWorkDir: undefined,
      defaultWorkDir: '/workspace',
      getPlanRecord: () => createPlanRecord(),
      getTurn: () => awaitingApprovalTurn,
      findLatestTurnByTask: () => awaitingApprovalTurn,
      startPlanExecution: vi.fn(() => ({
        status: 'ok',
        record: createPlanRecord({ status: 'executing', runId: 'run_exec' }),
        plan,
      })),
      cancelExpiredPlanTurns: vi.fn(),
      startTurnExecution: vi.fn(() => ({
        status: 'ok',
        turn: executingTurn,
        runtime: {
          taskId: 'task_exec_start',
          version: 0,
          status: 'running',
          activeTurnId: 'turn_exec_start',
          updatedAt: 1,
        },
      })),
      markPlanOrphaned: vi.fn(),
      bootstrapPlanningFiles,
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {
      throw new Error('expected ready result')
    }
    expect(result.plan).toEqual(plan)
    expect(result.activeTurn?.state).toBe('executing')
    expect(result.executionTaskId).toBe('task_exec_start')
    expect(result.effectiveWorkDir).toBe('/workspace')
    expect(result.executionWorkspaceDir).toBe('/workspace/sessions/task_exec_start')
    expect(result.progressFilePath).toBe(path.join('/workspace/sessions/task_exec_start', 'progress.md'))
    expect(bootstrapPlanningFiles).toHaveBeenCalledWith({
      workDir: '/workspace',
      taskId: 'task_exec_start',
      goal: plan.goal,
      steps: plan.steps.map((step) => step.description),
      notes: plan.notes,
      originalPrompt: 'Run this',
    })
  })
})
