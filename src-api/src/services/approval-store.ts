import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {
  ApprovalContext,
  ApprovalListFilter,
  ApprovalRequestKind,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
  ApprovalResolveResult,
  ApprovalStoreData,
} from '../types/approval'
import type { PendingQuestion, PermissionRequest } from '../types/agent-new'

const STORE_DIR = path.join(os.homedir(), '.easywork')
const STORE_FILE = path.join(STORE_DIR, 'approval-requests.json')
const STORE_VERSION = 1 as const

function createInitialData(): ApprovalStoreData {
  return {
    version: STORE_VERSION,
    requests: [],
  }
}

export class ApprovalStore {
  private data: ApprovalStoreData

  constructor() {
    this.data = this.load()
  }

  private ensureStoreDir(): void {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true })
    }
  }

  private normalizeRequest(raw: unknown): ApprovalRequestRecord | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id.trim()) return null
    if (value.kind !== 'permission' && value.kind !== 'question') return null
    if (!['pending', 'approved', 'rejected', 'expired', 'canceled', 'orphaned'].includes(String(value.status))) {
      return null
    }
    return {
      id: value.id,
      kind: value.kind as ApprovalRequestKind,
      status: value.status as ApprovalRequestStatus,
      runId: typeof value.runId === 'string'
        ? value.runId
        : typeof value.sessionId === 'string'
        ? value.sessionId
        : null,
      taskId: typeof value.taskId === 'string' ? value.taskId : null,
      providerSessionId: typeof value.providerSessionId === 'string' ? value.providerSessionId : null,
      permission: (value.permission as PermissionRequest | null) || null,
      question: (value.question as PendingQuestion | null) || null,
      source: value.source === 'clarification' || value.source === 'runtime_tool_question'
        ? value.source
        : null,
      round: typeof value.round === 'number' ? value.round : null,
      approved: typeof value.approved === 'boolean' ? value.approved : null,
      answers: value.answers && typeof value.answers === 'object'
        ? value.answers as Record<string, string>
        : null,
      reason: typeof value.reason === 'string' ? value.reason : null,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
      resolvedAt: typeof value.resolvedAt === 'number' ? value.resolvedAt : null,
    }
  }

  private load(): ApprovalStoreData {
    try {
      if (!fs.existsSync(STORE_FILE)) {
        return createInitialData()
      }
      const text = fs.readFileSync(STORE_FILE, 'utf-8')
      const parsed = JSON.parse(text) as ApprovalStoreData
      if (!parsed || !Array.isArray(parsed.requests)) {
        return createInitialData()
      }
      return {
        version: STORE_VERSION,
        requests: parsed.requests
          .map((item) => this.normalizeRequest(item))
          .filter((item): item is ApprovalRequestRecord => !!item),
      }
    } catch (error) {
      console.error('[ApprovalStore] Failed to load store:', error)
      return createInitialData()
    }
  }

  private persist(): void {
    try {
      this.ensureStoreDir()
      const tmpFile = `${STORE_FILE}.tmp`
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmpFile, STORE_FILE)
    } catch (error) {
      console.error('[ApprovalStore] Failed to persist store:', error)
      throw error
    }
  }

  private findRequestIndex(id: string): number {
    return this.data.requests.findIndex((item) => item.id === id)
  }

  private upsertPendingRecord(
    recordId: string,
    patch: {
      kind: 'permission' | 'question'
      context?: ApprovalContext
      permission?: PermissionRequest
      question?: PendingQuestion
    }
  ): ApprovalRequestRecord {
    const now = Date.now()
    const context = patch.context || {}
    const index = this.findRequestIndex(recordId)

    if (index >= 0) {
      const current = this.data.requests[index]
      const next: ApprovalRequestRecord = {
        ...current,
        kind: patch.kind,
        status: current.status === 'pending' ? 'pending' : current.status,
        runId: context.runId ?? current.runId,
        taskId: context.taskId ?? current.taskId,
        providerSessionId: context.providerSessionId ?? current.providerSessionId,
        permission: patch.kind === 'permission' ? (patch.permission || current.permission) : null,
        question: patch.kind === 'question' ? (patch.question || current.question) : null,
        source: patch.kind === 'question' ? (context.source ?? current.source) : null,
        round: patch.kind === 'question' ? (context.round ?? current.round) : null,
        expiresAt: context.expiresAt === undefined ? current.expiresAt : context.expiresAt,
        updatedAt: now,
      }
      this.data.requests[index] = next
      this.persist()
      return next
    }

    const created: ApprovalRequestRecord = {
      id: recordId,
      kind: patch.kind,
      status: 'pending',
      runId: context.runId || null,
      taskId: context.taskId || null,
      providerSessionId: context.providerSessionId || null,
      permission: patch.kind === 'permission' ? patch.permission || null : null,
      question: patch.kind === 'question' ? patch.question || null : null,
      source: patch.kind === 'question' ? context.source || null : null,
      round: patch.kind === 'question' ? context.round ?? null : null,
      approved: null,
      answers: null,
      reason: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: context.expiresAt ?? null,
      resolvedAt: null,
    }
    this.data.requests.push(created)
    this.persist()
    return created
  }

  upsertPendingPermission(permission: PermissionRequest, context?: ApprovalContext): ApprovalRequestRecord {
    return this.upsertPendingRecord(permission.id, {
      kind: 'permission',
      context,
      permission,
    })
  }

  upsertPendingQuestion(question: PendingQuestion, context?: ApprovalContext): ApprovalRequestRecord {
    return this.upsertPendingRecord(question.id, {
      kind: 'question',
      context,
      question,
    })
  }

  list(filter: ApprovalListFilter = {}): ApprovalRequestRecord[] {
    return this.data.requests
      .filter((item) => {
        if (filter.status && item.status !== filter.status) return false
        if (filter.kind && item.kind !== filter.kind) return false
        if (filter.taskId && item.taskId !== filter.taskId) return false
        if (filter.runId && item.runId !== filter.runId) return false
        if (filter.providerSessionId && item.providerSessionId !== filter.providerSessionId) return false
        if (filter.source && item.source !== filter.source) return false
        return true
      })
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  listPending(filter: Omit<ApprovalListFilter, 'status'> = {}): ApprovalRequestRecord[] {
    return this.list({ ...filter, status: 'pending' })
  }

  resolvePermission(id: string, approved: boolean, reason?: string): ApprovalResolveResult {
    const index = this.findRequestIndex(id)
    if (index < 0) {
      return { status: 'not_found', record: null }
    }

    const current = this.data.requests[index]
    if (current.kind !== 'permission') {
      return { status: 'not_found', record: null }
    }

    if (current.status !== 'pending') {
      return { status: 'already_resolved', record: current }
    }

    const now = Date.now()
    const next: ApprovalRequestRecord = {
      ...current,
      status: approved ? 'approved' : 'rejected',
      approved,
      reason: reason || null,
      updatedAt: now,
      resolvedAt: now,
    }
    this.data.requests[index] = next
    this.persist()
    return { status: 'resolved', record: next }
  }

  resolveQuestion(id: string, answers: Record<string, string>): ApprovalResolveResult {
    const index = this.findRequestIndex(id)
    if (index < 0) {
      return { status: 'not_found', record: null }
    }

    const current = this.data.requests[index]
    if (current.kind !== 'question') {
      return { status: 'not_found', record: null }
    }

    if (current.status !== 'pending') {
      return { status: 'already_resolved', record: current }
    }

    const now = Date.now()
    const next: ApprovalRequestRecord = {
      ...current,
      status: 'approved',
      answers,
      updatedAt: now,
      resolvedAt: now,
    }
    this.data.requests[index] = next
    this.persist()
    return { status: 'resolved', record: next }
  }

  updatePendingStatus(
    id: string,
    status: Exclude<ApprovalRequestStatus, 'pending'>,
    patch: Partial<Pick<ApprovalRequestRecord, 'reason' | 'approved' | 'answers'>> = {}
  ): ApprovalResolveResult {
    const index = this.findRequestIndex(id)
    if (index < 0) {
      return { status: 'not_found', record: null }
    }

    const current = this.data.requests[index]
    if (current.status !== 'pending') {
      return { status: 'already_resolved', record: current }
    }

    const now = Date.now()
    const next: ApprovalRequestRecord = {
      ...current,
      status,
      reason: patch.reason ?? current.reason,
      approved: patch.approved ?? current.approved,
      answers: patch.answers ?? current.answers,
      updatedAt: now,
      resolvedAt: now,
    }

    this.data.requests[index] = next
    this.persist()
    return { status: 'resolved', record: next }
  }

  markAllPendingAsOrphaned(): number {
    const now = Date.now()
    let changed = false
    let count = 0

    this.data.requests = this.data.requests.map((item) => {
      if (item.status !== 'pending') return item
      changed = true
      count += 1
      return {
        ...item,
        status: 'orphaned',
        reason: item.reason || 'API process restarted before approval was resolved.',
        updatedAt: now,
        resolvedAt: now,
      }
    })

    if (changed) this.persist()
    return count
  }

  expireDuePending(now: number = Date.now()): number {
    let changed = false
    let count = 0

    this.data.requests = this.data.requests.map((item) => {
      if (item.status !== 'pending') return item
      if (!item.expiresAt || item.expiresAt > now) return item
      changed = true
      count += 1
      return {
        ...item,
        status: 'expired',
        reason: item.reason || 'Permission request timed out.',
        updatedAt: now,
        resolvedAt: now,
      }
    })

    if (changed) this.persist()
    return count
  }

  countByStatus(): Record<ApprovalRequestStatus, number> {
    const counters: Record<ApprovalRequestStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      canceled: 0,
      orphaned: 0,
    }

    for (const item of this.data.requests) {
      counters[item.status] += 1
    }
    return counters
  }

  countByKind(): Record<ApprovalRequestKind, number> {
    const counters: Record<ApprovalRequestKind, number> = {
      permission: 0,
      question: 0,
    }
    for (const item of this.data.requests) {
      counters[item.kind] += 1
    }
    return counters
  }
}

export const approvalStore = new ApprovalStore()
