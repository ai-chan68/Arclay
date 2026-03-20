import type { PendingQuestion, PermissionRequest } from '../types/agent-new'
import type {
  ApprovalContext,
  ApprovalCoordinatorResolveResult,
  ApprovalListFilter,
  ApprovalRequestKind,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
} from '../types/approval'
import { approvalStore } from './approval-store'

type PermissionDecisionResolver = (decision: { approved: boolean; reason?: string }) => void
type QuestionDecisionResolver = (decision: { answers: Record<string, string> }) => void

interface ApprovalDiagnostics {
  scopedCount: number
  countsByStatus: Record<ApprovalRequestStatus, number>
  countsByKind: Record<ApprovalRequestKind, number>
  pending: ApprovalRequestRecord[]
  terminal: ApprovalRequestRecord[]
}

export class ApprovalCoordinator {
  private permissionResolvers = new Map<string, PermissionDecisionResolver>()
  private questionResolvers = new Map<string, QuestionDecisionResolver>()
  private lifecycleTimer: NodeJS.Timeout | null = null

  capturePermissionRequest(permission: PermissionRequest, context?: ApprovalContext): void {
    approvalStore.upsertPendingPermission(permission, context)
  }

  captureQuestionRequest(question: PendingQuestion, context?: ApprovalContext): void {
    approvalStore.upsertPendingQuestion(question, context)
  }

  attachPermissionResolver(permissionId: string, resolver: PermissionDecisionResolver): void {
    this.permissionResolvers.set(permissionId, resolver)
  }

  attachQuestionResolver(questionId: string, resolver: QuestionDecisionResolver): void {
    this.questionResolvers.set(questionId, resolver)
  }

  detachPermissionResolver(permissionId: string): void {
    this.permissionResolvers.delete(permissionId)
  }

  detachQuestionResolver(questionId: string): void {
    this.questionResolvers.delete(questionId)
  }

  listPending(filter: Omit<ApprovalListFilter, 'status'> = {}) {
    return approvalStore.listPending(filter)
  }

  list(filter: ApprovalListFilter = {}) {
    return approvalStore.list(filter)
  }

  getLatestTerminal(filter: Omit<ApprovalListFilter, 'status'> = {}): ApprovalRequestRecord | null {
    const terminal = approvalStore
      .list(filter)
      .filter((item) => item.status !== 'pending')
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return terminal[0] || null
  }

  getDiagnostics(filter: Omit<ApprovalListFilter, 'status'> = {}, limit = 20): ApprovalDiagnostics {
    const scopedRecords = approvalStore.list(filter)
    const countsByStatus: Record<ApprovalRequestStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      canceled: 0,
      orphaned: 0,
    }
    const countsByKind: Record<ApprovalRequestKind, number> = {
      permission: 0,
      question: 0,
    }

    for (const record of scopedRecords) {
      countsByStatus[record.status] += 1
      countsByKind[record.kind] += 1
    }

    const pending = scopedRecords
      .filter((item) => item.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)

    const terminal = scopedRecords
      .filter((item) => item.status !== 'pending')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)

    return {
      scopedCount: scopedRecords.length,
      countsByStatus,
      countsByKind,
      pending,
      terminal,
    }
  }

  markAllPendingAsOrphanedOnStartup(): number {
    // On API process restart, any unresolved request cannot be attached to a live runtime anymore.
    return approvalStore.markAllPendingAsOrphaned()
  }

  startLifecycleSweep(intervalMs = 15_000): void {
    if (this.lifecycleTimer) return
    this.lifecycleTimer = setInterval(() => {
      const expiredCount = approvalStore.expireDuePending()
      if (expiredCount > 0) {
        console.log(`[ApprovalCoordinator] Expired pending requests: ${expiredCount}`)
      }
    }, intervalMs)
    this.lifecycleTimer.unref?.()
  }

  stopLifecycleSweep(): void {
    if (!this.lifecycleTimer) return
    clearInterval(this.lifecycleTimer)
    this.lifecycleTimer = null
  }

  resolvePermission(permissionId: string, approved: boolean, reason?: string): ApprovalCoordinatorResolveResult {
    const result = approvalStore.resolvePermission(permissionId, approved, reason)
    const resolver = this.permissionResolvers.get(permissionId)

    let attachedToRuntime = false
    if (resolver) {
      attachedToRuntime = true
      this.permissionResolvers.delete(permissionId)
      resolver({ approved, reason })
    }

    return {
      status: result.status,
      attachedToRuntime,
      record: result.record,
    }
  }

  resolveQuestion(questionId: string, answers: Record<string, string>): ApprovalCoordinatorResolveResult {
    const result = approvalStore.resolveQuestion(questionId, answers)
    const resolver = this.questionResolvers.get(questionId)

    let attachedToRuntime = false
    if (resolver) {
      attachedToRuntime = true
      this.questionResolvers.delete(questionId)
      resolver({ answers })
    }

    return {
      status: result.status,
      attachedToRuntime,
      record: result.record,
    }
  }

  markPermissionExpired(permissionId: string, reason?: string): ApprovalCoordinatorResolveResult {
    const result = approvalStore.updatePendingStatus(permissionId, 'expired', {
      reason: reason || 'Permission request timed out.',
      approved: false,
    })
    this.permissionResolvers.delete(permissionId)
    return {
      status: result.status,
      attachedToRuntime: false,
      record: result.record,
    }
  }

  markPermissionCanceled(permissionId: string, reason?: string): ApprovalCoordinatorResolveResult {
    const result = approvalStore.updatePendingStatus(permissionId, 'canceled', {
      reason: reason || 'Permission request canceled.',
      approved: false,
    })
    this.permissionResolvers.delete(permissionId)
    return {
      status: result.status,
      attachedToRuntime: false,
      record: result.record,
    }
  }
}

export const approvalCoordinator = new ApprovalCoordinator()
