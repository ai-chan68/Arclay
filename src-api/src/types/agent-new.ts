/**
 * Types for the new two-phase execution agent API
 */

export interface TaskPlan {
  id: string
  goal: string
  steps: PlanStep[]
  notes?: string
  createdAt: Date
}

export interface PlanStep {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export interface PermissionRequest {
  id: string
  type: 'file_write' | 'file_delete' | 'command_exec' | 'network_access' | 'other'
  title: string
  description: string
  metadata?: Record<string, unknown>
}

export interface PendingQuestion {
  id: string
  question: string
  options?: string[]
  allowFreeText?: boolean
  source?: 'clarification' | 'runtime_tool_question'
  round?: number
}
