/**
 * Task State Machine
 *
 * Defines the state transitions for tasks:
 * - running: task is currently executing
 * - completed: task finished successfully
 * - error: task encountered an error
 * - stopped: task was manually stopped
 *
 * Note: easywork style - no 'idle' state, tasks start as 'running'
 */

import type { TaskStatus, AgentMessage, AgentError } from '@shared-types'

/**
 * Agent phase for UI state tracking (not persisted to database)
 */
export type AgentPhase = 'idle' | 'planning' | 'awaiting_approval' | 'awaiting_clarification' | 'executing' | 'blocked'

/**
 * Transition result
 */
export interface TransitionResult {
  status: TaskStatus
  phase: AgentPhase
}

/**
 * Valid state transitions
 * Note: easywork style - no 'idle' status
 */
const VALID_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  running: ['completed', 'error', 'stopped'],
  completed: ['running'], // Allow restart for follow-up
  error: ['running'], // Allow retry
  stopped: ['running'], // Allow restart
}

const VALID_PHASE_TRANSITIONS: Record<AgentPhase, AgentPhase[]> = {
  idle: ['planning'],
  planning: ['awaiting_approval', 'awaiting_clarification', 'executing', 'blocked', 'idle'],
  awaiting_approval: ['executing', 'idle'],
  awaiting_clarification: ['planning', 'blocked', 'idle'],
  executing: ['idle'],
  blocked: ['planning', 'idle'],
}

const PLACEHOLDER_ASSISTANT_PATTERNS = [
  /^i understand the request\b/i,
  /\blet me analyze\b/i,
  /\bproceed with the appropriate action\b/i,
  /^understood\b/i,
  /^got it\b/i,
  /^我先(?:来|看|分析|处理)/,
  /^我会先/,
  /^让我先/,
  /^我来(?:看|分析|处理)/,
]

const PROCESS_ASSISTANT_PATTERNS = [
  /^i['’]?ll start by\b/i,
  /^let me\b/i,
  /^i need to use\b/i,
  /^i see\b.*\boperating as\b/i,
  /^现在开始/i,
  /^现在(?:点击|输入|查看|打开|获取|提取|执行)/,
  /^页面已(?:导航|加载|跳转)/,
  /^批次号已输入/,
  /^表格数据已经提取到了。现在/,
  /^让我(?:点击|查看|打开|确认|尝试)/,
  /^我(?:先|会先|来)(?:点击|查看|打开|确认|尝试)/,
]

export function isPlaceholderAssistantResponse(content?: string | null): boolean {
  const normalized = content?.replace(/\s+/g, ' ').trim()
  if (!normalized) return false

  return PLACEHOLDER_ASSISTANT_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isProcessAssistantResponse(content?: string | null): boolean {
  const normalized = content?.replace(/\s+/g, ' ').trim()
  if (!normalized) return false

  return PROCESS_ASSISTANT_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function hasMeaningfulCompletionSignal(messages: AgentMessage[]): boolean {
  if (messages.some((message) => message.type === 'result' && message.content?.trim())) {
    return true
  }

  return messages.some((message) => (
    message.type === 'text' &&
    message.role !== 'user' &&
    !!message.content?.trim() &&
    !isPlaceholderAssistantResponse(message.content) &&
    !isProcessAssistantResponse(message.content)
  ))
}

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  from: TaskStatus,
  to: TaskStatus
): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Check if a phase transition is valid
 */
export function isValidPhaseTransition(
  from: AgentPhase,
  to: AgentPhase
): boolean {
  return VALID_PHASE_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Get next status based on current state and event
 */
export function getNextStatus(
  currentStatus: TaskStatus,
  event: 'start' | 'complete' | 'error' | 'stop' | 'retry'
): TaskStatus | null {
  switch (event) {
    case 'start':
      return 'running'
    case 'complete':
      return isValidStatusTransition(currentStatus, 'completed') ? 'completed' : null
    case 'error':
      return isValidStatusTransition(currentStatus, 'error') ? 'error' : null
    case 'stop':
      return isValidStatusTransition(currentStatus, 'stopped') ? 'stopped' : null
    case 'retry':
      return isValidStatusTransition(currentStatus, 'running') ? 'running' : null
    default:
      return null
  }
}

/**
 * Get next phase based on current phase and event
 */
export function getNextPhase(
  currentPhase: AgentPhase,
  event: 'start' | 'plan_ready' | 'needs_clarification' | 'approve' | 'reject' | 'complete'
): AgentPhase | null {
  switch (event) {
    case 'start':
      return isValidPhaseTransition(currentPhase, 'planning') ? 'planning' : null
    case 'plan_ready':
      return isValidPhaseTransition(currentPhase, 'awaiting_approval')
        ? 'awaiting_approval'
        : isValidPhaseTransition(currentPhase, 'executing')
        ? 'executing'
        : null
    case 'needs_clarification':
      return isValidPhaseTransition(currentPhase, 'awaiting_clarification')
        ? 'awaiting_clarification'
        : null
    case 'approve':
      return isValidPhaseTransition(currentPhase, 'executing') ? 'executing' : null
    case 'reject':
      return isValidPhaseTransition(currentPhase, 'idle') ? 'idle' : null
    case 'complete':
      return isValidPhaseTransition(currentPhase, 'idle') ? 'idle' : null
    default:
      return null
  }
}

/**
 * Derive task status from messages
 * Note: easywork style - no 'idle' status, defaults to 'running'
 */
export function deriveStatusFromMessages(
  messages: AgentMessage[],
  isRunning: boolean
): TaskStatus {
  if (isRunning) return 'running'

  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.type === 'user' && message.role === 'user')
    ?.index ?? -1

  const latestTurnMessages = lastUserIndex >= 0
    ? messages.slice(lastUserIndex)
    : messages

  const hasPendingInteraction = latestTurnMessages.some((message) =>
    message.type === 'clarification_request' || message.type === 'permission_request'
  )
  if (hasPendingInteraction) return 'running'

  const latestErrorIndex = latestTurnMessages.reduce((lastIndex, message, index) => (
    message.type === 'error' ? index : lastIndex
  ), -1)
  const completionWindow = latestErrorIndex >= 0
    ? latestTurnMessages.slice(latestErrorIndex + 1)
    : latestTurnMessages
  const hasRecoveredCompletion = completionWindow.some((message) => message.type === 'done') &&
    hasMeaningfulCompletionSignal(completionWindow)
  if (hasRecoveredCompletion) return 'completed'

  const hasError = latestTurnMessages.some((m) => m.type === 'error')
  if (hasError) return 'error'

  const hasDone = latestTurnMessages.some((m) => m.type === 'done')
  if (hasDone && hasMeaningfulCompletionSignal(latestTurnMessages)) return 'completed'

  // Without explicit terminal signals (done/error), prefer running.
  // This avoids false "completed" during task-switch hydration windows.
  return 'running'
}

export function resolveTaskStatus({
  currentStatus,
  derivedStatus,
  isRunning,
  interruptedByApproval,
  manuallyStopped,
  statusFromTurnState,
}: {
  currentStatus: TaskStatus
  derivedStatus: TaskStatus
  isRunning: boolean
  interruptedByApproval: boolean
  manuallyStopped: boolean
  statusFromTurnState: TaskStatus | null
}): TaskStatus {
  if (interruptedByApproval) return 'stopped'
  if (manuallyStopped && !isRunning) return 'stopped'
  if (statusFromTurnState && !isRunning) return statusFromTurnState

  const hasTerminalTaskStatus =
    currentStatus === 'completed' ||
    currentStatus === 'error' ||
    currentStatus === 'stopped'

  const shouldRepairRecoveredCompletion =
    currentStatus === 'error' &&
    derivedStatus === 'completed' &&
    !isRunning

  if (shouldRepairRecoveredCompletion) {
    return 'completed'
  }

  const shouldTrustTerminalTaskStatus =
    hasTerminalTaskStatus &&
    !isRunning &&
    !interruptedByApproval &&
    !manuallyStopped

  if (shouldTrustTerminalTaskStatus) {
    return currentStatus
  }

  return derivedStatus
}

export function shouldApplyTerminalExecutionFailure({
  hasExecutionError,
  isRunning,
  isTurnComplete,
}: {
  hasExecutionError: boolean
  isRunning: boolean
  isTurnComplete: boolean
}): boolean {
  return hasExecutionError && !isRunning && isTurnComplete
}

export function isTaskActivelyRunning({
  phase,
  error,
}: {
  phase: AgentPhase
  error?: AgentError | null
}): boolean {
  if (error) return false

  return (
    phase === 'planning' ||
    phase === 'awaiting_approval' ||
    phase === 'awaiting_clarification' ||
    phase === 'blocked' ||
    phase === 'executing'
  )
}

/**
 * Derive agent phase from messages
 */
export function derivePhaseFromMessages(
  messages: AgentMessage[],
  isRunning: boolean,
  pendingPlan: boolean
): AgentPhase {
  if (!isRunning) return 'idle'

  if (pendingPlan) return 'awaiting_approval'

  const hasClarification = messages.some((m) => m.type === 'clarification_request')
  if (hasClarification) return 'awaiting_clarification'

  const hasPlan = messages.some((m) => m.type === 'plan')
  if (hasPlan) return 'executing'

  return 'planning'
}

/**
 * Create initial task state
 * Note: easywork style - tasks start as 'running', not 'idle'
 */
export function createInitialTaskState(): TransitionResult {
  return {
    status: 'running',
    phase: 'idle',
  }
}
