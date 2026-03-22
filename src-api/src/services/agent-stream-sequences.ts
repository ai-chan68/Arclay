import type { AgentMessage } from '@shared-types'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import type { EventStreamWriter, StreamMessageOptions } from './agent-stream-events'
import { createDoneMessage, emitSseMessage } from './agent-stream-events'

type EmitTurnState = (
  writer: EventStreamWriter,
  result: TurnTransitionResult | { turn: TurnRecord | null }
) => Promise<void>

export interface EmitMessagesAndDoneInput extends StreamMessageOptions {
  messages: AgentMessage[]
}

export interface EmitMessagesInput {
  messages: AgentMessage[]
}

export async function emitMessages(
  writer: EventStreamWriter,
  input: EmitMessagesInput
): Promise<void> {
  for (const message of input.messages) {
    await emitSseMessage(writer, message)
  }
}

export async function emitMessagesAndDone(
  writer: EventStreamWriter,
  input: EmitMessagesAndDoneInput
): Promise<void> {
  await emitMessages(writer, input)
  await emitSseMessage(writer, createDoneMessage(input))
}

export interface EmitMessagesTurnTransitionAndDoneInput extends EmitMessagesAndDoneInput {
  turnTransition: TurnTransitionResult | null
  emitTurnState: EmitTurnState
}

export interface EmitMessagesAndTurnTransitionInput {
  messages: AgentMessage[]
  turnTransition: TurnTransitionResult | null
  emitTurnState: EmitTurnState
}

export async function emitMessagesAndTurnTransition(
  writer: EventStreamWriter,
  input: EmitMessagesAndTurnTransitionInput
): Promise<void> {
  await emitMessages(writer, input)
  if (input.turnTransition?.turn) {
    await input.emitTurnState(writer, input.turnTransition)
  }
}

export interface EmitTurnTransitionAndMessagesInput {
  turnTransition: TurnTransitionResult | null
  messages: AgentMessage[]
  emitTurnState: EmitTurnState
}

export async function emitTurnTransitionAndMessages(
  writer: EventStreamWriter,
  input: EmitTurnTransitionAndMessagesInput
): Promise<void> {
  if (input.turnTransition?.turn) {
    await input.emitTurnState(writer, input.turnTransition)
  }
  await emitMessages(writer, input)
}

export async function emitMessagesTurnTransitionAndDone(
  writer: EventStreamWriter,
  input: EmitMessagesTurnTransitionAndDoneInput
): Promise<void> {
  await emitMessagesAndTurnTransition(writer, input)
  await emitSseMessage(writer, createDoneMessage(input))
}

export interface EmitTurnTransitionAndDoneInput extends StreamMessageOptions {
  turnTransition: TurnTransitionResult | null
  emitTurnState: EmitTurnState
}

export async function emitTurnTransitionAndDone(
  writer: EventStreamWriter,
  input: EmitTurnTransitionAndDoneInput
): Promise<void> {
  if (input.turnTransition?.turn) {
    await input.emitTurnState(writer, input.turnTransition)
  }
  await emitSseMessage(writer, createDoneMessage(input))
}

export interface EmitBlockedTurnAndDoneInput extends StreamMessageOptions {
  transitions: TurnTransitionResult[]
  fallbackTurn: TurnRecord | null
  blockedMessage: AgentMessage
  emitTurnState: EmitTurnState
}

export async function emitBlockedTurnAndDone(
  writer: EventStreamWriter,
  input: EmitBlockedTurnAndDoneInput
): Promise<void> {
  for (const transition of input.transitions) {
    if (transition.turn) {
      await input.emitTurnState(writer, transition)
    }
  }

  if (input.fallbackTurn && input.transitions.length === 0) {
    await input.emitTurnState(writer, { turn: input.fallbackTurn })
  }

  await emitSseMessage(writer, input.blockedMessage)
  await emitSseMessage(writer, createDoneMessage(input))
}
