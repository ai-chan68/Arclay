import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskPlan } from '../../types/agent-new'
import { PlanStore } from '../plan-store'

function createPlan(id: string): TaskPlan {
  return {
    id,
    goal: `Goal for ${id}`,
    steps: [
      {
        id: 'step_1',
        description: 'Run first step',
        status: 'pending',
      },
    ],
    createdAt: new Date(),
  }
}

describe('PlanStore', () => {
  let tmpDir = ''
  let storeFile = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-plan-store-'))
    storeFile = path.join(tmpDir, 'plans.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('enforces CAS semantics for execution idempotency', () => {
    const store = new PlanStore({ storeFile })
    const plan = createPlan('plan_cas')

    store.upsertPendingPlan(plan)

    const first = store.startExecution(plan.id)
    expect(first.status).toBe('ok')

    const second = store.startExecution(plan.id)
    expect(second.status).toBe('conflict')
    if (second.status === 'conflict') {
      expect(second.record.status).toBe('executing')
    }

    const executed = store.markExecuted(plan.id)
    expect(executed?.status).toBe('executed')

    const third = store.startExecution(plan.id)
    expect(third.status).toBe('conflict')
    if (third.status === 'conflict') {
      expect(third.record.status).toBe('executed')
    }
  })

  it('marks executing plans orphaned and expired pending plans during startup sweep', () => {
    const store = new PlanStore({ storeFile })
    const expiredPlan = createPlan('plan_expired')
    const executingPlan = createPlan('plan_executing')

    store.upsertPendingPlan(expiredPlan, { expiresAt: Date.now() - 1_000 })
    store.upsertPendingPlan(executingPlan)
    store.startExecution(executingPlan.id)

    const result = store.sweepOnStartup()

    expect(result.expiredCount).toBe(1)
    expect(result.orphanedCount).toBe(1)
    expect(store.getRecord(expiredPlan.id)?.status).toBe('expired')
    expect(store.getRecord(expiredPlan.id)?.failReason).toBe('approval_timeout')
    expect(store.getRecord(executingPlan.id)?.status).toBe('orphaned')
    expect(store.getRecord(executingPlan.id)?.failReason).toBe('process_restart')
  })

  it('records failReason for rejected and orphaned plans', () => {
    const store = new PlanStore({ storeFile })
    const rejectedPlan = createPlan('plan_rejected')
    const orphanedPlan = createPlan('plan_orphaned')

    store.upsertPendingPlan(rejectedPlan)
    store.upsertPendingPlan(orphanedPlan)
    store.startExecution(orphanedPlan.id)

    const rejected = store.markRejected(rejectedPlan.id, 'Rejected by user.')
    const orphaned = store.markOrphaned(orphanedPlan.id, 'Execution aborted by user.', 'user_cancelled')

    expect(rejected?.status).toBe('rejected')
    expect(rejected?.failReason).toBe('approval_rejected')
    expect(orphaned?.status).toBe('orphaned')
    expect(orphaned?.failReason).toBe('user_cancelled')
  })

  it('compacts old terminal records outside retention window', () => {
    const store = new PlanStore({ storeFile, retentionMs: 1 })
    const plan = createPlan('plan_compact')

    store.upsertPendingPlan(plan)
    store.startExecution(plan.id)
    store.markExecuted(plan.id)

    const removed = store.compact(Date.now() + 10)
    expect(removed).toBe(1)
    expect(store.getRecord(plan.id)).toBeNull()
  })

  it('returns expired pending plan records so turn state can be synchronized', () => {
    const store = new PlanStore({ storeFile })
    const expiredPlan = createPlan('plan_expired_callback')
    const activePlan = createPlan('plan_active_callback')

    store.upsertPendingPlan(expiredPlan, {
      taskId: 'task_expired',
      turnId: 'turn_expired',
      expiresAt: Date.now() - 1_000,
    })
    store.upsertPendingPlan(activePlan, {
      taskId: 'task_active',
      turnId: 'turn_active',
      expiresAt: Date.now() + 60_000,
    })

    const result = store.expireDuePending()

    expect(result.count).toBe(1)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.id).toBe(expiredPlan.id)
    expect(result.records[0]?.turnId).toBe('turn_expired')
    expect(result.records[0]?.status).toBe('expired')
    expect(store.getRecord(expiredPlan.id)?.status).toBe('expired')
    expect(store.getRecord(activePlan.id)?.status).toBe('pending_approval')
  })
})
