import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { TaskPlan } from '../types/agent-new'
import type {
  PlanExpirationResult,
  PlanFailReason,
  PlanRecord,
  PlanRecordStatus,
  PlanStoreData,
  PlanStoreSweepResult,
  StoredTaskPlan,
} from '../types/plan-store'

const STORE_DIR = path.join(os.homedir(), '.easywork')
const STORE_FILE = path.join(STORE_DIR, 'plans.json')
const STORE_VERSION = 1 as const
const DEFAULT_PENDING_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const TERMINAL_STATUSES: PlanRecordStatus[] = [
  'executed',
  'rejected',
  'expired',
  'orphaned',
]

interface PlanStoreOptions {
  storeFile?: string
  pendingTtlMs?: number
  retentionMs?: number
}

type PlanStartResult =
  | { status: 'ok'; record: PlanRecord; plan: TaskPlan }
  | { status: 'not_found' }
  | { status: 'conflict'; record: PlanRecord }

function createInitialData(): PlanStoreData {
  return {
    version: STORE_VERSION,
    plans: [],
  }
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value instanceof Date) return value.getTime()
  return null
}

function cloneRecord(record: PlanRecord): PlanRecord {
  return JSON.parse(JSON.stringify(record)) as PlanRecord
}

export class PlanStore {
  private data: PlanStoreData
  private readonly storeFile: string
  private readonly pendingTtlMs: number
  private readonly retentionMs: number
  private lifecycleTimer: NodeJS.Timeout | null = null

  constructor(options: PlanStoreOptions = {}) {
    this.storeFile = options.storeFile || STORE_FILE
    this.pendingTtlMs = options.pendingTtlMs && options.pendingTtlMs > 0
      ? options.pendingTtlMs
      : DEFAULT_PENDING_TTL_MS
    this.retentionMs = options.retentionMs && options.retentionMs > 0
      ? options.retentionMs
      : DEFAULT_RETENTION_MS
    this.data = this.load()
  }

  private ensureStoreDir(): void {
    const dir = path.dirname(this.storeFile)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  private normalizeRecord(raw: unknown): PlanRecord | null {
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim()) return null
    if (!record.plan || typeof record.plan !== 'object') return null

    const planRaw = record.plan as Record<string, unknown>
    if (typeof planRaw.id !== 'string' || !planRaw.id.trim()) return null
    if (typeof planRaw.goal !== 'string') return null
    if (!Array.isArray(planRaw.steps)) return null

    const planCreatedAt = toTimestamp(planRaw.createdAt) ?? Date.now()
    const createdAt = toTimestamp(record.createdAt) ?? Date.now()
    const updatedAt = toTimestamp(record.updatedAt) ?? createdAt
    const expiresAt = toTimestamp(record.expiresAt)
    const executedAt = toTimestamp(record.executedAt)

    const normalizedStatus = typeof record.status === 'string'
      ? (record.status as PlanRecordStatus)
      : 'pending_approval'
    const status: PlanRecordStatus = [
      'pending_approval',
      'executing',
      'executed',
      'rejected',
      'expired',
      'orphaned',
    ].includes(normalizedStatus)
      ? normalizedStatus
      : 'pending_approval'

    return {
      id: record.id,
      taskId: typeof record.taskId === 'string' && record.taskId.trim() ? record.taskId : null,
      runId: typeof record.runId === 'string' && record.runId.trim()
        ? record.runId
        : typeof record.sessionId === 'string' && record.sessionId.trim()
        ? record.sessionId
        : null,
      turnId: typeof record.turnId === 'string' && record.turnId.trim() ? record.turnId : null,
      status,
      failReason: [
        'approval_rejected',
        'approval_timeout',
        'user_cancelled',
        'process_restart',
        'version_conflict',
        'execution_error',
      ].includes(String(record.failReason))
        ? record.failReason as PlanFailReason
        : null,
      plan: {
        id: planRaw.id,
        goal: planRaw.goal,
        steps: planRaw.steps as TaskPlan['steps'],
        notes: typeof planRaw.notes === 'string' ? planRaw.notes : undefined,
        createdAt: planCreatedAt,
      },
      createdAt,
      updatedAt,
      expiresAt,
      executedAt,
      reason: typeof record.reason === 'string' ? record.reason : null,
    }
  }

  private load(): PlanStoreData {
    try {
      if (!fs.existsSync(this.storeFile)) {
        return createInitialData()
      }

      const text = fs.readFileSync(this.storeFile, 'utf-8')
      const parsed = JSON.parse(text) as PlanStoreData
      if (!parsed || !Array.isArray(parsed.plans)) {
        return createInitialData()
      }

      return {
        version: STORE_VERSION,
        plans: parsed.plans
          .map((item) => this.normalizeRecord(item))
          .filter((item): item is PlanRecord => !!item),
      }
    } catch (error) {
      console.error('[PlanStore] Failed to load store:', error)
      return createInitialData()
    }
  }

  private persist(): void {
    try {
      this.ensureStoreDir()
      const tmpFile = `${this.storeFile}.tmp`
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmpFile, this.storeFile)
    } catch (error) {
      console.error('[PlanStore] Failed to persist store:', error)
      throw error
    }
  }

  private findPlanIndex(id: string): number {
    return this.data.plans.findIndex((item) => item.id === id)
  }

  private toStoredPlan(plan: TaskPlan): StoredTaskPlan {
    const createdAt = toTimestamp(plan.createdAt) ?? Date.now()
    return {
      id: plan.id,
      goal: plan.goal,
      steps: plan.steps,
      notes: plan.notes,
      createdAt,
    }
  }

  private toTaskPlan(stored: StoredTaskPlan): TaskPlan {
    return {
      id: stored.id,
      goal: stored.goal,
      steps: stored.steps,
      notes: stored.notes,
      createdAt: new Date(stored.createdAt),
    }
  }

  upsertPendingPlan(
    plan: TaskPlan,
    context: { taskId?: string; runId?: string; turnId?: string; expiresAt?: number } = {}
  ): PlanRecord {
    const now = Date.now()
    const expiresAt = context.expiresAt ?? now + this.pendingTtlMs
    const nextRecord: PlanRecord = {
      id: plan.id,
      taskId: context.taskId || null,
      runId: context.runId || null,
      turnId: context.turnId || null,
      status: 'pending_approval',
      failReason: null,
      plan: this.toStoredPlan(plan),
      createdAt: now,
      updatedAt: now,
      expiresAt,
      executedAt: null,
      reason: null,
    }

    const index = this.findPlanIndex(plan.id)
    if (index >= 0) {
      const existing = this.data.plans[index]
      const merged: PlanRecord = {
        ...existing,
        ...nextRecord,
        createdAt: existing.createdAt,
        failReason: null,
      }
      this.data.plans[index] = merged
      this.persist()
      return cloneRecord(merged)
    }

    this.data.plans.push(nextRecord)
    this.persist()
    return cloneRecord(nextRecord)
  }

  getRecord(planId: string): PlanRecord | null {
    const record = this.data.plans.find((item) => item.id === planId)
    return record ? cloneRecord(record) : null
  }

  getPlan(planId: string): TaskPlan | null {
    const record = this.data.plans.find((item) => item.id === planId)
    if (!record) return null
    return this.toTaskPlan(record.plan)
  }

  startExecution(
    planId: string,
    context: { taskId?: string; runId?: string; turnId?: string } = {}
  ): PlanStartResult {
    const index = this.findPlanIndex(planId)
    if (index < 0) {
      return { status: 'not_found' }
    }

    const current = this.data.plans[index]
    const now = Date.now()

    if (current.status !== 'pending_approval') {
      return { status: 'conflict', record: cloneRecord(current) }
    }

    if (current.expiresAt && current.expiresAt <= now) {
      const expiredRecord: PlanRecord = {
        ...current,
        status: 'expired',
        failReason: 'approval_timeout',
        updatedAt: now,
        reason: current.reason || 'Plan expired before execution.',
      }
      this.data.plans[index] = expiredRecord
      this.persist()
      return { status: 'conflict', record: cloneRecord(expiredRecord) }
    }

    const nextRecord: PlanRecord = {
      ...current,
      status: 'executing',
      failReason: null,
      taskId: context.taskId || current.taskId,
      runId: context.runId || current.runId,
      turnId: context.turnId || current.turnId,
      updatedAt: now,
      reason: null,
    }
    this.data.plans[index] = nextRecord
    this.persist()

    return {
      status: 'ok',
      record: cloneRecord(nextRecord),
      plan: this.toTaskPlan(nextRecord.plan),
    }
  }

  markExecuted(planId: string): PlanRecord | null {
    const index = this.findPlanIndex(planId)
    if (index < 0) return null

    const current = this.data.plans[index]
    if (current.status !== 'executing') {
      return cloneRecord(current)
    }

    const now = Date.now()
    const next: PlanRecord = {
      ...current,
      status: 'executed',
      failReason: null,
      updatedAt: now,
      executedAt: now,
      reason: null,
    }
    this.data.plans[index] = next
    this.persist()
    return cloneRecord(next)
  }

  markOrphaned(
    planId: string,
    reason?: string,
    failReason: Exclude<PlanFailReason, null> = 'execution_error'
  ): PlanRecord | null {
    const index = this.findPlanIndex(planId)
    if (index < 0) return null

    const current = this.data.plans[index]
    if (current.status !== 'executing') {
      return cloneRecord(current)
    }

    const now = Date.now()
    const next: PlanRecord = {
      ...current,
      status: 'orphaned',
      failReason,
      updatedAt: now,
      reason: reason || 'Execution was interrupted before completion.',
    }
    this.data.plans[index] = next
    this.persist()
    return cloneRecord(next)
  }

  markRejected(planId: string, reason?: string): PlanRecord | null {
    const index = this.findPlanIndex(planId)
    if (index < 0) return null

    const current = this.data.plans[index]
    if (current.status !== 'pending_approval') {
      return cloneRecord(current)
    }

    const now = Date.now()
    const next: PlanRecord = {
      ...current,
      status: 'rejected',
      failReason: 'approval_rejected',
      updatedAt: now,
      reason: reason || 'Rejected by user.',
    }
    this.data.plans[index] = next
    this.persist()
    return cloneRecord(next)
  }

  expireDuePending(now: number = Date.now()): PlanExpirationResult {
    let count = 0
    let changed = false
    const records: PlanRecord[] = []

    this.data.plans = this.data.plans.map((record) => {
      if (record.status !== 'pending_approval') return record
      if (!record.expiresAt || record.expiresAt > now) return record

      count += 1
      changed = true
      const next: PlanRecord = {
        ...record,
        status: 'expired',
        failReason: 'approval_timeout',
        updatedAt: now,
        reason: record.reason || 'Plan expired before approval.',
      }
      records.push(cloneRecord(next))
      return next
    })

    if (changed) this.persist()
    return {
      count,
      records,
    }
  }

  markExecutingAsOrphanedOnStartup(now: number = Date.now()): number {
    let count = 0
    let changed = false

    this.data.plans = this.data.plans.map((record) => {
      if (record.status !== 'executing') return record
      count += 1
      changed = true
      return {
        ...record,
        status: 'orphaned',
        failReason: 'process_restart',
        updatedAt: now,
        reason: record.reason || 'API process restarted while plan was executing.',
      }
    })

    if (changed) this.persist()
    return count
  }

  compact(now: number = Date.now()): number {
    const cutoff = now - this.retentionMs
    const before = this.data.plans.length

    this.data.plans = this.data.plans.filter((record) => {
      if (!TERMINAL_STATUSES.includes(record.status)) return true
      return record.updatedAt >= cutoff
    })

    const removed = before - this.data.plans.length
    if (removed > 0) this.persist()
    return removed
  }

  sweepOnStartup(): PlanStoreSweepResult {
    const orphanedCount = this.markExecutingAsOrphanedOnStartup()
    const expiredResult = this.expireDuePending()
    const compactedCount = this.compact()
    return {
      orphanedCount,
      expiredCount: expiredResult.count,
      expiredRecords: expiredResult.records,
      compactedCount,
    }
  }

  startLifecycleSweep(
    intervalMs = 60_000,
    onExpired?: (records: PlanRecord[]) => void
  ): void {
    if (this.lifecycleTimer) return
    this.lifecycleTimer = setInterval(() => {
      const expiredResult = this.expireDuePending()
      const compactedCount = this.compact()
      if (expiredResult.records.length > 0) {
        onExpired?.(expiredResult.records)
      }
      if (expiredResult.count > 0 || compactedCount > 0) {
        console.log('[PlanStore] Lifecycle sweep:', { expiredCount: expiredResult.count, compactedCount })
      }
    }, intervalMs)
    this.lifecycleTimer.unref?.()
  }

  stopLifecycleSweep(): void {
    if (!this.lifecycleTimer) return
    clearInterval(this.lifecycleTimer)
    this.lifecycleTimer = null
  }
}

export const planStore = new PlanStore()
