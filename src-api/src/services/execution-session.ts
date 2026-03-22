import type { AgentMessage, MessageAttachment } from '@shared-types'
import type { PendingQuestion, TaskPlan } from '../types/agent-new'
import type { PlanFailReason } from '../types/plan-store'
import type {
  ExecutionStartResult,
  TaskRuntimeRecord,
  TurnRecord,
  TurnTransitionResult,
} from '../types/turn-runtime'
import { createErrorMessage, createSessionMessage } from './agent-stream-events'
import { runExecutionAttemptLoop } from './execution-attempt-loop'
import type { ExecutionCompletionSummary } from './execution-completion'
import { resolveExecutionPostRun } from './execution-post-run'
import { finalizeExecutionLifecycle } from './execution-lifecycle'
import type { ExecutionObservation, RuntimeGateResult } from './execution-runtime-gate'

export interface RunExecutionSessionInput {
  planId: string
  runId: string
  promptText: string
  plan: TaskPlan
  activeTurn: TurnRecord | null
  executionTaskId: string
  executionPrompt: string
  progressPath: string
  executionSummary: ExecutionCompletionSummary
  runtimeGateRequired: boolean
  browserAutomationIntent: boolean
  maxExecutionAttempts: number
  effectiveWorkDir: string
  executionWorkspaceDir: string
  contextLogLines: string[]
  streamExecution: (
    promptForAttempt: string
  ) => AsyncIterable<AgentMessage>
  isAborted: () => boolean
  processExecutionMessage: (
    message: AgentMessage,
    observation: ExecutionObservation
  ) => Promise<{
    executionFailed: boolean
    executionFailureReason: string | null
    shouldForward: boolean
  }>
  createObservation: () => ExecutionObservation
  collectObservation: (message: AgentMessage, observation: ExecutionObservation) => void
  evaluateRuntimeGate: (observation: ExecutionObservation, workDir: string) => Promise<RuntimeGateResult>
  emitMessage: (message: AgentMessage) => Promise<void>
  emitMessages: (messages: AgentMessage[]) => Promise<void>
  emitTurnState: (result: TurnTransitionResult | { turn: TurnRecord | null }) => Promise<void>
  emitMessagesAndTurnTransition: (input: {
    messages: AgentMessage[]
    turnTransition: TurnTransitionResult | null
  }) => Promise<void>
  emitTurnTransitionAndDone: (result: TurnTransitionResult | { turn: TurnRecord | null } | null) => Promise<void>
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
  markPlanOrphaned: (
    planId: string,
    reason: string,
    failReason: Exclude<PlanFailReason, null>
  ) => void
  markPlanExecuted: (planId: string) => void
  cancelTurn: (turnId: string, reason?: string) => TurnTransitionResult
  failTurn: (turnId: string, reason?: string) => TurnTransitionResult
  completeTurn: (turnId: string, artifactContent?: string) => TurnTransitionResult
  cancelPendingApprovals?: (scope: {
    taskId?: string
    runId?: string
    providerSessionId?: string
  }, reason: string) => number
  orphanPendingApprovals?: (scope: {
    taskId?: string
    runId?: string
    providerSessionId?: string
  }, reason: string) => number
  deleteRun: (runId: string) => void
  formatExecutionSummary: (summary: ExecutionCompletionSummary) => string
  logInfo: (message: string) => void
  logWarn: (message: string) => void
  createId: (prefix: string) => string
  buildRuntimeRepairPrompt?: (executionPrompt: string, gate: RuntimeGateResult, workDir: string) => string
  now?: () => Date
}

export async function runExecutionSession(
  input: RunExecutionSessionInput
): Promise<void> {
  const now = input.now || (() => new Date())
  let executionStarted = false
  let abortedByUser = false
  let executionFailed = false
  let executionInterrupted = false
  let executionAwaitingUser = false
  let executionFailureReason = 'Execution failed before completion.'
  let activeTurn = input.activeTurn

  try {
    executionStarted = true

    await input.emitMessage(createSessionMessage(input.runId, {
      createId: input.createId,
      now: now(),
    }))
    if (activeTurn) {
      await input.emitTurnState({ turn: activeTurn })
    }

    await input.appendProgressEntry(input.progressPath, input.contextLogLines)

    const attemptLoopResult = await runExecutionAttemptLoop({
      executionPrompt: input.executionPrompt,
      executionWorkspaceDir: input.executionWorkspaceDir,
      effectiveWorkDir: input.effectiveWorkDir,
      progressPath: input.progressPath,
      runId: input.runId,
      executionSummary: input.executionSummary,
      runtimeGateRequired: input.runtimeGateRequired,
      maxExecutionAttempts: input.maxExecutionAttempts,
      createObservation: input.createObservation,
      collectObservation: input.collectObservation,
      evaluateRuntimeGate: input.evaluateRuntimeGate,
      streamExecution: input.streamExecution,
      isAborted: input.isAborted,
      handleMessage: input.processExecutionMessage,
      emitMessage: input.emitMessage,
      appendProgressEntry: input.appendProgressEntry,
      createId: input.createId,
      now,
      buildRuntimeRepairPrompt: input.buildRuntimeRepairPrompt,
    })

    abortedByUser = attemptLoopResult.abortedByUser
    executionFailed = attemptLoopResult.executionFailed
    executionFailureReason = attemptLoopResult.executionFailureReason

    if (input.runtimeGateRequired && !attemptLoopResult.runtimeGatePassed && !executionFailed && !abortedByUser) {
      executionFailed = true
      executionFailureReason = 'Runtime verification failed after execution.'
    }

    if (!executionFailed && !abortedByUser) {
      const postRunResult = await resolveExecutionPostRun({
        executionTaskId: input.executionTaskId,
        runId: input.runId,
        progressPath: input.progressPath,
        executionSummary: input.executionSummary,
        promptText: input.promptText,
        plan: input.plan,
        activeTurn,
        appendProgressEntry: input.appendProgressEntry,
        captureQuestionRequest: input.captureQuestionRequest,
        recountPendingInteractions: input.recountPendingInteractions,
        markTurnAwaitingClarification: input.markTurnAwaitingClarification,
        createId: input.createId,
        now: now(),
      })

      input.executionSummary.pendingInteractionCount = postRunResult.pendingInteractionCount
      activeTurn = postRunResult.activeTurn

      await input.emitMessagesAndTurnTransition({
        messages: postRunResult.messages,
        turnTransition: postRunResult.turnTransition,
      })

      executionAwaitingUser = postRunResult.executionAwaitingUser
      executionInterrupted = postRunResult.executionInterrupted

      if (postRunResult.executionFailed) {
        executionFailed = true
        executionFailureReason = postRunResult.executionFailureReason
        input.logWarn(
          `[execution-session] Suspicious execution completion for plan ${input.planId}: ${input.formatExecutionSummary(input.executionSummary)}`
        )
      } else if (postRunResult.status === 'completed') {
        input.logInfo(
          `[execution-session] Execution summary for plan ${input.planId}: ${input.formatExecutionSummary(input.executionSummary)}`
        )
      }
    }
  } catch (error) {
    executionFailed = true
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    executionFailureReason = errorMessage
    await input.emitMessages([
      createErrorMessage(errorMessage, {
        createId: input.createId,
        now: now(),
      }),
    ])
  } finally {
    input.deleteRun(input.runId)
    if (executionStarted) {
      const finalizeResult = await finalizeExecutionLifecycle({
        planId: input.planId,
        taskId: input.executionTaskId,
        runId: input.runId,
        progressPath: input.progressPath,
        executionSummaryText: input.formatExecutionSummary(input.executionSummary),
        executionStarted,
        abortedByUser,
        executionFailed,
        executionAwaitingUser,
        executionInterrupted,
        executionFailureReason,
        activeTurn,
        appendProgressEntry: input.appendProgressEntry,
        markPlanOrphaned: input.markPlanOrphaned,
        markPlanExecuted: input.markPlanExecuted,
        cancelTurn: input.cancelTurn,
        failTurn: input.failTurn,
        completeTurn: input.completeTurn,
        cancelPendingApprovals: input.cancelPendingApprovals,
        orphanPendingApprovals: input.orphanPendingApprovals,
        now: now(),
      })
      activeTurn = finalizeResult.activeTurn

      await input.emitTurnTransitionAndDone(activeTurn ? { turn: activeTurn } : null)
    }
  }
}
