import type { PendingQuestion, PermissionRequest } from '../types/agent-new'
import type {
  ApprovalRequestKind,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
} from '../types/approval'

export interface ApprovalDiagnosticsSnapshot {
  scopedCount: number
  countsByStatus: Record<ApprovalRequestStatus, number>
  countsByKind: Record<ApprovalRequestKind, number>
  pending: ApprovalRequestRecord[]
  terminal: ApprovalRequestRecord[]
}

export function buildPendingApprovalsResponse(input: {
  pendingItems: ApprovalRequestRecord[]
  latestTerminal: ApprovalRequestRecord | null
}): {
  pendingPermissions: PermissionRequest[]
  pendingQuestions: PendingQuestion[]
  pendingCount: number
  latestTerminal: ApprovalRequestRecord | null
} {
  const pendingPermissions = input.pendingItems
    .filter((item) => item.kind === 'permission')
    .map((item) => item.permission)
    .filter((item): item is PermissionRequest => !!item)

  const pendingQuestions = input.pendingItems
    .filter((item) => item.kind === 'question')
    .reduce<PendingQuestion[]>((acc, item) => {
      if (!item.question) return acc
      acc.push({
        ...item.question,
        source: item.source || undefined,
        round: item.round ?? undefined,
      })
      return acc
    }, [])

  return {
    pendingPermissions,
    pendingQuestions,
    pendingCount: input.pendingItems.length,
    latestTerminal: input.latestTerminal,
  }
}

export function normalizeApprovalDiagnosticsLimit(limitRaw?: string): number {
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20
}

export function buildApprovalDiagnosticsResponse(input: {
  taskId?: string
  runId?: string
  kind?: ApprovalRequestKind
  limit: number
  diagnostics: ApprovalDiagnosticsSnapshot
}): ApprovalDiagnosticsSnapshot & {
  taskId: string | null
  runId: string | null
  kind: ApprovalRequestKind | null
  limit: number
} {
  return {
    ...input.diagnostics,
    taskId: input.taskId || null,
    runId: input.runId || null,
    kind: input.kind || null,
    limit: input.limit,
  }
}
