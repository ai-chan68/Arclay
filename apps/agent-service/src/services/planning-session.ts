import type { AgentMessage } from '@shared-types'
import type { PendingQuestion, TaskPlan } from '../types/agent-new'
import type { ConversationMessage } from '../core/agent/interface'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import { resolvePlanningEntry, type ResolvePlanningEntryInput } from './planning-entry'
import {
  runPlanningStreamLoop,
  type RunPlanningStreamLoopInput,
} from './planning-stream-loop'
import {
  resolvePlanningPostRun,
  type ResolvePlanningPostRunInput,
} from './planning-post-run'
import type { PlanningStreamState } from './planning-stream-processing'

export interface RunPlanningSessionInput {
  planningPrompt: string
  rawPrompt: string
  runId: string
  taskId?: string
  maxClarificationRounds: number
  activeTurn: TurnRecord | null
  streamPlanning: () => AsyncIterable<AgentMessage>
  isAborted: () => boolean
  emitMessage: (message: AgentMessage) => Promise<void>
  emitMessages: (input: { messages: AgentMessage[] }) => Promise<void>
  emitTurnState: (result: TurnTransitionResult) => Promise<void>
  emitBlockedTurnAndDone: (input: {
    transitions: TurnTransitionResult[]
    fallbackTurn: TurnRecord | null
    blockedMessage: AgentMessage
    emitTurnState: (result: TurnTransitionResult) => Promise<void>
    createId: (prefix: string) => string
  }) => Promise<void>
  emitMessagesAndDone: (input: {
    messages: AgentMessage[]
    createId: (prefix: string) => string
  }) => Promise<void>
  emitMessagesTurnTransitionAndDone: (input: {
    messages: AgentMessage[]
    turnTransition: TurnTransitionResult | null
    emitTurnState: (result: TurnTransitionResult) => Promise<void>
    createId: (prefix: string) => string
  }) => Promise<void>
  emitMessagesAndTurnTransition: (input: {
    messages: AgentMessage[]
    turnTransition: TurnTransitionResult | null
    emitTurnState: (result: TurnTransitionResult) => Promise<void>
  }) => Promise<void>
  emitTurnTransitionAndDone: (input: {
    turnTransition: TurnTransitionResult
    emitTurnState: (result: TurnTransitionResult) => Promise<void>
    createId: (prefix: string) => string
  }) => Promise<void>
  deleteRun: (runId: string) => void
  resolvePlanningEntryInput: Omit<
    ResolvePlanningEntryInput,
    'planningPrompt' | 'taskId' | 'runId' | 'maxClarificationRounds' | 'activeTurn'
  >
  planningLoopInput: Pick<
    RunPlanningStreamLoopInput,
    'initialPlanningState' | 'handleMessage'
  >
  planningPostRunInput: Omit<
    ResolvePlanningPostRunInput,
    'prompt' | 'planningState' | 'runAborted' | 'activeTurn' | 'taskId' | 'runId'
  >
  resolvePlanningEntryFn?: typeof resolvePlanningEntry
  runPlanningStreamLoopFn?: typeof runPlanningStreamLoop
  resolvePlanningPostRunFn?: typeof resolvePlanningPostRun
  failTurn: (turnId: string, reason?: string) => TurnTransitionResult
  createSessionMessage: (runId: string) => AgentMessage
  createDoneMessage: () => AgentMessage
  createErrorMessage: (message: string) => AgentMessage
}

export async function runPlanningSession(
  input: RunPlanningSessionInput
): Promise<void> {
  const resolvePlanningEntryFn = input.resolvePlanningEntryFn || resolvePlanningEntry
  const runPlanningStreamLoopFn = input.runPlanningStreamLoopFn || runPlanningStreamLoop
  const resolvePlanningPostRunFn = input.resolvePlanningPostRunFn || resolvePlanningPostRun
  let activeTurn = input.activeTurn

  try {
    await input.emitMessage(input.createSessionMessage(input.runId))

    const planningEntryResult = resolvePlanningEntryFn({
      ...input.resolvePlanningEntryInput,
      planningPrompt: input.planningPrompt,
      taskId: input.taskId,
      runId: input.runId,
      maxClarificationRounds: input.maxClarificationRounds,
      activeTurn,
    })
    activeTurn = planningEntryResult.activeTurn

    if (planningEntryResult.status === 'blocked_done') {
      await input.emitBlockedTurnAndDone({
        transitions: planningEntryResult.transitions,
        fallbackTurn: planningEntryResult.fallbackTurn,
        blockedMessage: planningEntryResult.blockedMessage!,
        emitTurnState: input.emitTurnState,
        createId: input.resolvePlanningEntryInput.createId,
      })
      return
    }

    if (planningEntryResult.status === 'messages_done') {
      await input.emitMessagesAndDone({
        messages: planningEntryResult.messages,
        createId: input.resolvePlanningEntryInput.createId,
      })
      return
    }

    if (planningEntryResult.status === 'messages_turn_done') {
      await input.emitMessagesTurnTransitionAndDone({
        messages: planningEntryResult.messages,
        turnTransition: planningEntryResult.turnTransition,
        emitTurnState: input.emitTurnState,
        createId: input.resolvePlanningEntryInput.createId,
      })
      return
    }

    for (const transition of planningEntryResult.transitions) {
      if (transition.turn) {
        await input.emitTurnState(transition)
      }
    }

    const planningLoopResult = await runPlanningStreamLoopFn({
      ...input.planningLoopInput,
      initialActiveTurn: activeTurn,
      streamPlanning: input.streamPlanning,
      isAborted: input.isAborted,
      emitMessage: input.emitMessage,
      emitMessagesAndTurnTransition: async (loopInput) => {
        await input.emitMessagesAndTurnTransition({
          ...loopInput,
          emitTurnState: input.emitTurnState,
        })
      },
    })
    let planningState = planningLoopResult.planningState
    activeTurn = planningLoopResult.activeTurn

    const planningPostRunResult = resolvePlanningPostRunFn({
      ...input.planningPostRunInput,
      prompt: input.rawPrompt,
      planningState,
      runAborted: input.isAborted(),
      activeTurn,
      taskId: input.taskId,
      runId: input.runId,
    })
    planningState = planningPostRunResult.planningState
    activeTurn = planningPostRunResult.activeTurn
    void planningState

    await input.emitMessages({
      messages: planningPostRunResult.messages,
    })

    if (planningPostRunResult.turnTransition?.turn) {
      await input.emitTurnTransitionAndDone({
        turnTransition: planningPostRunResult.turnTransition,
        emitTurnState: input.emitTurnState,
        createId: input.planningPostRunInput.createId,
      })
      return
    }

    await input.emitMessage(input.createDoneMessage())
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorMsg = input.createErrorMessage(errorMessage)
    let failedTransition: TurnTransitionResult | null = null
    if (activeTurn) {
      const failed = input.failTurn(activeTurn.id, errorMessage)
      if (failed.turn) {
        activeTurn = failed.turn
        failedTransition = failed
      }
    }
    await input.emitMessagesAndTurnTransition({
      messages: [errorMsg],
      turnTransition: failedTransition,
      emitTurnState: input.emitTurnState,
    })
  } finally {
    input.deleteRun(input.runId)
  }
}
