import type { AgentMessage } from '@shared-types'
import type { PendingQuestion, TaskPlan } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import type { ExecutionCompletionSummary } from './execution-completion'
import { detectIncompleteExecution, shouldTreatMaxTurnsAsInterrupted } from './execution-completion'
import { createErrorMessage } from './agent-stream-events'
import { resolveExecutionPause } from './execution-pause'

export type ExecutionPostRunStatus =
  | 'waiting_for_user'
  | 'interrupted'
  | 'failed'
  | 'completed'

export interface ResolveExecutionPostRunInput {
  executionTaskId: string
  runId: string
  progressPath: string
  executionSummary: ExecutionCompletionSummary
  promptText: string
  plan: TaskPlan
  activeTurn: TurnRecord | null
  appendProgressEntry: (progressPath: string, lines: string[]) => Promise<void>
  captureQuestionRequest: (
    question: PendingQuestion,
    context: {
      taskId: string
      runId: string
      providerSessionId: string
      source: 'runtime_tool_question'
    }
  ) => void
  recountPendingInteractions: () => number
  markTurnAwaitingClarification: (turnId: string) => TurnTransitionResult
  createId: (prefix: string) => string
  now?: Date
}

export interface ResolveExecutionPostRunResult {
  status: ExecutionPostRunStatus
  pendingInteractionCount: number
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  executionAwaitingUser: boolean
  executionInterrupted: boolean
  executionFailed: boolean
  executionFailureReason: string
  messages: AgentMessage[]
}

export async function resolveExecutionPostRun(
  input: ResolveExecutionPostRunInput
): Promise<ResolveExecutionPostRunResult> {
  input.executionSummary.pendingInteractionCount = input.recountPendingInteractions()

  const pauseResult = await resolveExecutionPause({
    executionTaskId: input.executionTaskId,
    runId: input.runId,
    progressPath: input.progressPath,
    pendingInteractionCount: input.executionSummary.pendingInteractionCount,
    blockerCandidate: input.executionSummary.blockerCandidate,
    activeTurn: input.activeTurn,
    appendProgressEntry: input.appendProgressEntry,
    captureQuestionRequest: input.captureQuestionRequest,
    recountPendingInteractions: input.recountPendingInteractions,
    markTurnAwaitingClarification: input.markTurnAwaitingClarification,
    createId: input.createId,
    now: input.now,
  })

  input.executionSummary.pendingInteractionCount = pauseResult.pendingInteractionCount

  if (pauseResult.shouldPause) {
    return {
      status: 'waiting_for_user',
      pendingInteractionCount: pauseResult.pendingInteractionCount,
      activeTurn: pauseResult.activeTurn,
      turnTransition: pauseResult.turnTransition,
      executionAwaitingUser: true,
      executionInterrupted: false,
      executionFailed: false,
      executionFailureReason: '',
      messages: pauseResult.clarificationMessage ? [pauseResult.clarificationMessage] : [],
    }
  }

  if (shouldTreatMaxTurnsAsInterrupted(input.executionSummary)) {
    return {
      status: 'interrupted',
      pendingInteractionCount: input.executionSummary.pendingInteractionCount,
      activeTurn: pauseResult.activeTurn,
      turnTransition: null,
      executionAwaitingUser: false,
      executionInterrupted: true,
      executionFailed: false,
      executionFailureReason: '',
      messages: [{
        id: input.createId('msg'),
        type: 'result',
        role: 'assistant',
        content: '执行达到轮次上限，已保留当前进展，可继续执行以完成剩余步骤。',
        timestamp: (input.now || new Date()).getTime(),
      }],
    }
  }

  const incompleteReason = detectIncompleteExecution(
    input.executionSummary,
    input.promptText,
    input.plan
  )

  if (incompleteReason) {
    const isPartialCompletion = incompleteReason.startsWith('PARTIAL_COMPLETION:')
    if (isPartialCompletion) {
      const detail = incompleteReason.slice('PARTIAL_COMPLETION:'.length)
      return {
        status: 'interrupted',
        pendingInteractionCount: input.executionSummary.pendingInteractionCount,
        activeTurn: pauseResult.activeTurn,
        turnTransition: null,
        executionAwaitingUser: false,
        executionInterrupted: true,
        executionFailed: false,
        executionFailureReason: '',
        messages: [{
          id: input.createId('msg'),
          type: 'result',
          role: 'assistant',
          content: `执行部分完成：${detail} 已产出的文件成果已保留，可继续执行以完成剩余步骤。`,
          timestamp: (input.now || new Date()).getTime(),
        }],
      }
    }
    return {
      status: 'failed',
      pendingInteractionCount: input.executionSummary.pendingInteractionCount,
      activeTurn: pauseResult.activeTurn,
      turnTransition: null,
      executionAwaitingUser: false,
      executionInterrupted: false,
      executionFailed: true,
      executionFailureReason: incompleteReason,
      messages: [
        createErrorMessage(incompleteReason, {
          createId: input.createId,
          now: input.now,
        }),
      ],
    }
  }

  return {
    status: 'completed',
    pendingInteractionCount: input.executionSummary.pendingInteractionCount,
    activeTurn: pauseResult.activeTurn,
    turnTransition: null,
    executionAwaitingUser: false,
    executionInterrupted: false,
    executionFailed: false,
    executionFailureReason: '',
    messages: [],
  }
}
