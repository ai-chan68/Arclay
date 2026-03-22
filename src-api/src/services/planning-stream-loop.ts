import type { AgentMessage } from '@shared-types'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import type { PlanningStreamState } from './planning-stream-processing'

export interface HandlePlanningStreamLoopMessageResult {
  planningState: PlanningStreamState
  activeTurn: TurnRecord | null
  turnTransition: TurnTransitionResult | null
  errorMessage: AgentMessage | null
  shouldBreak: boolean
  shouldForward: boolean
}

export interface RunPlanningStreamLoopInput {
  initialPlanningState: PlanningStreamState
  initialActiveTurn: TurnRecord | null
  streamPlanning: () => AsyncIterable<AgentMessage>
  isAborted: () => boolean
  handleMessage: (
    message: AgentMessage,
    planningState: PlanningStreamState,
    activeTurn: TurnRecord | null
  ) => Promise<HandlePlanningStreamLoopMessageResult>
  emitMessage: (message: AgentMessage) => Promise<void>
  emitMessagesAndTurnTransition: (input: {
    messages: AgentMessage[]
    turnTransition: TurnTransitionResult | null
  }) => Promise<void>
}

export interface RunPlanningStreamLoopResult {
  planningState: PlanningStreamState
  activeTurn: TurnRecord | null
  wasAborted: boolean
}

export async function runPlanningStreamLoop(
  input: RunPlanningStreamLoopInput
): Promise<RunPlanningStreamLoopResult> {
  let planningState = input.initialPlanningState
  let activeTurn = input.initialActiveTurn

  for await (const message of input.streamPlanning()) {
    if (input.isAborted()) {
      return {
        planningState,
        activeTurn,
        wasAborted: true,
      }
    }

    const processedMessage = await input.handleMessage(message, planningState, activeTurn)
    planningState = processedMessage.planningState
    activeTurn = processedMessage.activeTurn

    if (processedMessage.errorMessage) {
      await input.emitMessagesAndTurnTransition({
        messages: [processedMessage.errorMessage],
        turnTransition: processedMessage.turnTransition,
      })
    }

    if (processedMessage.shouldBreak) {
      break
    }

    if (processedMessage.shouldForward) {
      await input.emitMessage(message)
    }
  }

  return {
    planningState,
    activeTurn,
    wasAborted: input.isAborted(),
  }
}
