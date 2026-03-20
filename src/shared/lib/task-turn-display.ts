import type { TaskStatus } from '@shared-types'

export type WorkspaceDisplayPhase =
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_clarification'
  | 'execution'
  | 'stopped'
  | 'failed'

export function getWorkspaceDisplayState({
  isStopped,
  isRunning,
  taskStatus,
  hasError,
  isLatestTurn,
  isAwaitingApproval,
  isAwaitingClarification,
  hasPlanForApproval,
  hasExecutionTrace,
  hasResultMessage,
  artifactsCount,
  hasPendingPermission,
  hasPendingQuestion,
  hasLatestApprovalTerminal,
  hasPlan,
}: {
  isStopped: boolean
  isRunning: boolean
  taskStatus?: TaskStatus
  hasError: boolean
  isLatestTurn: boolean
  isAwaitingApproval: boolean
  isAwaitingClarification: boolean
  hasPlanForApproval: boolean
  hasExecutionTrace: boolean
  hasResultMessage: boolean
  artifactsCount: number
  hasPendingPermission: boolean
  hasPendingQuestion: boolean
  hasLatestApprovalTerminal: boolean
  hasPlan: boolean
}): {
  phase: WorkspaceDisplayPhase
  showPlanSection: boolean
} {
  const phase: WorkspaceDisplayPhase =
    isStopped
      ? 'stopped'
      : !isRunning && (taskStatus === 'error' || hasError)
      ? 'failed'
      : isLatestTurn && isAwaitingApproval && hasPlanForApproval && !hasExecutionTrace && !hasResultMessage && artifactsCount === 0
      ? 'awaiting_approval'
      : isLatestTurn && isAwaitingClarification && hasPendingQuestion
      ? 'awaiting_clarification'
      : (isLatestTurn && isRunning && !isAwaitingApproval && !isAwaitingClarification) ||
        hasExecutionTrace ||
        hasResultMessage ||
        artifactsCount > 0 ||
        hasPendingPermission ||
        hasPendingQuestion ||
        hasLatestApprovalTerminal
      ? 'execution'
      : 'planning'

  return {
    phase,
    showPlanSection: hasPlan && (phase === 'execution' || phase === 'awaiting_clarification' || phase === 'failed'),
  }
}
