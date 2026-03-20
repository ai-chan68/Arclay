import type { PendingQuestion, PermissionRequest } from './agent-new'

export type ApprovalRequestKind = 'permission' | 'question'
export type ApprovalQuestionSource = 'clarification' | 'runtime_tool_question'

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'canceled'
  | 'orphaned'

export interface ApprovalContext {
  runId?: string
  taskId?: string
  providerSessionId?: string
  expiresAt?: number | null
  source?: ApprovalQuestionSource
  round?: number
}

export interface ApprovalRequestRecord {
  id: string
  kind: ApprovalRequestKind
  status: ApprovalRequestStatus
  runId: string | null
  taskId: string | null
  providerSessionId: string | null
  permission: PermissionRequest | null
  question: PendingQuestion | null
  source: ApprovalQuestionSource | null
  round: number | null
  approved: boolean | null
  answers: Record<string, string> | null
  reason: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  resolvedAt: number | null
}

export interface ApprovalStoreData {
  version: 1
  requests: ApprovalRequestRecord[]
}

export interface ApprovalListFilter {
  status?: ApprovalRequestStatus
  kind?: ApprovalRequestKind
  taskId?: string
  runId?: string
  providerSessionId?: string
  source?: ApprovalQuestionSource
}

export interface ApprovalResolveResult {
  status: 'resolved' | 'already_resolved' | 'not_found'
  record: ApprovalRequestRecord | null
}

export interface ApprovalCoordinatorResolveResult {
  status: 'resolved' | 'already_resolved' | 'not_found'
  attachedToRuntime: boolean
  record: ApprovalRequestRecord | null
}
