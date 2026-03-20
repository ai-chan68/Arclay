import type { TaskPlan } from './agent-new'

export type PlanRecordStatus =
  | 'pending_approval'
  | 'executing'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'orphaned'

export type PlanFailReason =
  | 'approval_rejected'
  | 'approval_timeout'
  | 'user_cancelled'
  | 'process_restart'
  | 'version_conflict'
  | 'execution_error'
  | null

export interface StoredTaskPlan {
  id: string
  goal: string
  steps: TaskPlan['steps']
  notes?: string
  createdAt: number
}

export interface PlanRecord {
  id: string
  taskId: string | null
  runId: string | null
  turnId: string | null
  status: PlanRecordStatus
  failReason: PlanFailReason
  plan: StoredTaskPlan
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  executedAt: number | null
  reason: string | null
}

export interface PlanStoreData {
  version: 1
  plans: PlanRecord[]
}

export interface PlanExpirationResult {
  count: number
  records: PlanRecord[]
}

export interface PlanStoreSweepResult {
  orphanedCount: number
  expiredCount: number
  expiredRecords: PlanRecord[]
  compactedCount: number
}
