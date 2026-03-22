import type { AgentMessage } from '@shared-types'
import type { PendingQuestion } from '../types/agent-new'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import type { ExecutionBlockerCandidate } from './execution-completion'

export interface ResolveExecutionPauseInput {
  executionTaskId: string
  runId: string
  progressPath: string
  pendingInteractionCount: number
  blockerCandidate: ExecutionBlockerCandidate | null
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

export interface ResolveExecutionPauseResult {
  shouldPause: boolean
  pendingInteractionCount: number
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  clarificationMessage: AgentMessage | null
}

function buildExecutionBlockedQuestion(candidate: ExecutionBlockerCandidate, createId: (prefix: string) => string): PendingQuestion {
  return {
    id: createId('question'),
    question: candidate.userMessage,
    options: ['已处理，请继续', '需要我补充信息'],
    allowFreeText: true,
    source: 'runtime_tool_question',
  }
}

export async function resolveExecutionPause(
  input: ResolveExecutionPauseInput
): Promise<ResolveExecutionPauseResult> {
  const hasPauseCondition = input.pendingInteractionCount > 0 || !!input.blockerCandidate
  if (!hasPauseCondition) {
    return {
      shouldPause: false,
      pendingInteractionCount: input.pendingInteractionCount,
      activeTurn: input.activeTurn,
      turnTransition: null,
      clarificationMessage: null,
    }
  }

  let pendingInteractionCount = input.pendingInteractionCount
  let clarificationMessage: AgentMessage | null = null
  let userActionMessage = input.blockerCandidate?.userMessage || '执行需要你的输入后才能继续，请处理后回复我继续。'

  if (pendingInteractionCount === 0) {
    const question = buildExecutionBlockedQuestion(
      input.blockerCandidate || {
        reason: 'Execution is waiting for user input.',
        userMessage: userActionMessage,
      },
      input.createId
    )

    input.captureQuestionRequest(question, {
      taskId: input.executionTaskId,
      runId: input.runId,
      providerSessionId: input.runId,
      source: 'runtime_tool_question',
    })
    pendingInteractionCount = input.recountPendingInteractions()

    clarificationMessage = {
      id: input.createId('msg'),
      type: 'clarification_request',
      role: 'assistant',
      content: question.question,
      clarification: question,
      question,
      timestamp: (input.now || new Date()).getTime(),
    }
    userActionMessage = question.question
  }

  await input.appendProgressEntry(input.progressPath, [
    `### Execution Pause (${(input.now || new Date()).toISOString()})`,
    '- Status: waiting_for_user',
    `- Reason: ${input.blockerCandidate?.reason || 'Execution is waiting for user input.'}`,
    `- User Action Required: ${userActionMessage}`,
  ])

  let activeTurn = input.activeTurn
  let turnTransition: TurnTransitionResult | null = null
  if (activeTurn) {
    turnTransition = input.markTurnAwaitingClarification(activeTurn.id)
    if (turnTransition.turn) {
      activeTurn = turnTransition.turn
    }
  }

  return {
    shouldPause: true,
    pendingInteractionCount,
    activeTurn,
    turnTransition,
    clarificationMessage,
  }
}
