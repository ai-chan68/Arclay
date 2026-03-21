export type TurnState =
  | 'queued'
  | 'analyzing'
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_clarification'
  | 'executing'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskRuntimeStatus = 'idle' | 'running' | 'awaiting' | 'blocked' | 'error'

export interface TaskRuntimeRecord {
  taskId: string
  version: number
  status: TaskRuntimeStatus
  activeTurnId: string | null
  updatedAt: number
}

export interface TurnRecord {
  id: string
  taskId: string
  runId: string | null
  prompt: string
  state: TurnState
  readVersion: number
  writeVersion: number | null
  blockedByTurnIds: string[]
  reason: string | null
  createdAt: number
  updatedAt: number
}

export interface TurnArtifactRecord {
  id: string
  taskId: string
  turnId: string
  type: 'summary' | 'decision' | 'output'
  content: string
  createdAt: number
}

export interface TurnRuntimeStoreData {
  version: 1
  runtimes: TaskRuntimeRecord[]
  turns: TurnRecord[]
  artifacts: TurnArtifactRecord[]
}

export interface CreateTurnInput {
  taskId: string
  prompt: string
  runId?: string
  turnId?: string
  readVersion?: number
  dependsOnTurnIds?: string[]
}

export interface CreateTurnResult {
  created: boolean
  turn: TurnRecord
  runtime: TaskRuntimeRecord
}

export interface TurnTransitionResult {
  status: 'ok' | 'not_found' | 'conflict' | 'blocked'
  turn: TurnRecord | null
  runtime: TaskRuntimeRecord | null
  reason?: string
}

export interface ExecutionStartResult extends TurnTransitionResult {
  status: 'ok' | 'not_found' | 'conflict' | 'blocked'
  code?: 'TURN_NOT_FOUND' | 'TURN_STATE_CONFLICT' | 'TURN_BLOCKED' | 'TURN_VERSION_CONFLICT'
}
