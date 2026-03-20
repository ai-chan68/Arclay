import type { AgentMessage, TaskStatus } from '@shared-types'
import type { Artifact } from '../types/artifacts'
import { pickPrimaryArtifactForPreview } from './file-utils'

export type WorkspaceDisplayPhase =
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_clarification'
  | 'execution'
  | 'stopped'
  | 'failed'

export type TurnResultKind = 'none' | 'text' | 'artifact' | 'mixed'

export interface TurnResultView {
  kind: TurnResultKind
  text?: string
  artifacts: Artifact[]
  previewTargetId?: string
}

export interface TurnDisplayModel {
  phase: WorkspaceDisplayPhase
  showPlanSection: boolean
  hasThinking: boolean
  hasError: boolean
  availableResult: TurnResultView
  visibleResult: TurnResultView
}

function createEmptyResult(): TurnResultView {
  return {
    kind: 'none',
    text: undefined,
    artifacts: [],
    previewTargetId: undefined,
  }
}

function getStableResultText(resultMessage?: Pick<AgentMessage, 'content' | 'isTemporary'> | null): string | undefined {
  const content = resultMessage?.content?.trim()
  if (!content) return undefined
  if (resultMessage?.isTemporary) return undefined
  return content
}

function buildResultView({
  resultMessage,
  artifacts,
}: {
  resultMessage?: Pick<AgentMessage, 'content' | 'isTemporary'> | null
  artifacts: Artifact[]
}): TurnResultView {
  const text = getStableResultText(resultMessage)
  const preferredArtifact = pickPrimaryArtifactForPreview(artifacts)
  const hasText = typeof text === 'string' && text.length > 0
  const hasArtifacts = artifacts.length > 0

  if (!hasText && !hasArtifacts) {
    return createEmptyResult()
  }

  return {
    kind: hasText && hasArtifacts ? 'mixed' : hasText ? 'text' : 'artifact',
    text,
    artifacts,
    previewTargetId: preferredArtifact?.id,
  }
}

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

export function buildTurnDisplayModel({
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
  artifacts,
  hasPendingPermission,
  hasPendingQuestion,
  hasLatestApprovalTerminal,
  hasPlan,
  isTurnComplete,
  resultMessage,
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
  artifacts: Artifact[]
  hasPendingPermission: boolean
  hasPendingQuestion: boolean
  hasLatestApprovalTerminal: boolean
  hasPlan: boolean
  isTurnComplete: boolean
  resultMessage?: Pick<AgentMessage, 'content' | 'isTemporary'> | null
}): TurnDisplayModel {
  const displayState = getWorkspaceDisplayState({
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
    artifactsCount: artifacts.length,
    hasPendingPermission,
    hasPendingQuestion,
    hasLatestApprovalTerminal,
    hasPlan,
  })

  const availableResult = buildResultView({
    resultMessage,
    artifacts,
  })

  const hasPendingInteraction =
    hasPendingPermission ||
    hasPendingQuestion ||
    hasLatestApprovalTerminal ||
    isAwaitingApproval ||
    isAwaitingClarification

  const canRevealFinalOutput = isTurnComplete && !isRunning && !hasPendingInteraction
  const visibleResult = canRevealFinalOutput ? availableResult : createEmptyResult()

  return {
    phase: displayState.phase,
    showPlanSection: displayState.showPlanSection,
    hasThinking:
      hasExecutionTrace || (isRunning && !isAwaitingApproval && !isAwaitingClarification),
    hasError,
    availableResult,
    visibleResult,
  }
}
