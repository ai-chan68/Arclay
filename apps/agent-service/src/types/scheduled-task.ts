import type { TaskPlan } from '../types/agent-new'

export type ScheduledTaskLastStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'skipped'

export type ScheduledTaskBreakerState = 'closed' | 'open' | 'half_open'

export type ScheduledTaskOverlapPolicy = 'forbid'

export type ScheduledTaskTriggerType = 'cron' | 'manual' | 'recovery_probe'

export type ScheduledTaskRunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'skipped'

export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  cronExpr: string
  timezone: string
  sourcePrompt: string
  approvedPlan: TaskPlan | null
  executionPromptSnapshot: string
  workDir?: string
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: ScheduledTaskLastStatus
  consecutiveFailures: number
  breakerState: ScheduledTaskBreakerState
  breakerOpenedAt: number | null
  breakerCooldownUntil: number | null
  breakerOpenCount24h: number
  breakerOpenWindowStartedAt: number | null
  autoDisabledByBreaker: boolean
  maxConsecutiveFailures: number
  cooldownSeconds: number
  timeoutSeconds: number
  overlapPolicy: ScheduledTaskOverlapPolicy
  createdAt: number
  updatedAt: number
}

export interface ScheduledTaskRun {
  id: string
  taskId: string
  triggerType: ScheduledTaskTriggerType
  scheduledAt: number | null
  startedAt: number
  finishedAt: number | null
  status: ScheduledTaskRunStatus
  errorCode: string | null
  errorMessage: string | null
  durationMs: number | null
  sessionId: string | null
  meta: Record<string, unknown> | null
}

export interface ScheduledTaskStoreData {
  version: 1
  tasks: ScheduledTask[]
  runs: ScheduledTaskRun[]
}

export interface ScheduledTaskListQuery {
  enabled?: boolean
  breakerState?: ScheduledTaskBreakerState
  keyword?: string
  page?: number
  pageSize?: number
}

export interface ScheduledTaskRunListQuery {
  taskId?: string
  page?: number
  pageSize?: number
}

export interface CreateScheduledTaskInput {
  name: string
  enabled?: boolean
  cronExpr: string
  timezone?: string
  sourcePrompt: string
  approvedPlan: TaskPlan
  executionPromptSnapshot: string
  workDir?: string
  maxConsecutiveFailures?: number
  cooldownSeconds?: number
  timeoutSeconds?: number
}

export interface UpdateScheduledTaskInput {
  name?: string
  enabled?: boolean
  cronExpr?: string
  timezone?: string
  sourcePrompt?: string
  approvedPlan?: TaskPlan
  executionPromptSnapshot?: string
  workDir?: string
  maxConsecutiveFailures?: number
  cooldownSeconds?: number
  timeoutSeconds?: number
}
