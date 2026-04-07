import type { AgentMessage } from '@shared-types'
import type { TurnRecord } from '../types/turn-runtime'

export interface EventStreamWriter {
  write: (chunk: string) => unknown
}

export interface StreamMessageOptions {
  createId: (prefix: string) => string
  now?: Date
}

function resolveTimestamp(now?: Date): number {
  return (now || new Date()).getTime()
}

export function createSessionMessage(
  sessionId: string,
  options: StreamMessageOptions
): AgentMessage {
  return {
    id: options.createId('msg'),
    type: 'session',
    sessionId,
    timestamp: resolveTimestamp(options.now),
  }
}

export function createDoneMessage(options: StreamMessageOptions): AgentMessage {
  return {
    id: options.createId('msg'),
    type: 'done',
    timestamp: resolveTimestamp(options.now),
  }
}

export function createErrorMessage(
  errorMessage: string,
  options: StreamMessageOptions
): AgentMessage {
  return {
    id: options.createId('msg'),
    type: 'error',
    errorMessage,
    timestamp: resolveTimestamp(options.now),
  }
}

export function createTurnStateMessage(
  turn: TurnRecord,
  taskVersion: number,
  options: StreamMessageOptions
): AgentMessage {
  return {
    id: options.createId('msg'),
    type: 'turn_state',
    timestamp: resolveTimestamp(options.now),
    turn: {
      taskId: turn.taskId,
      turnId: turn.id,
      state: turn.state,
      taskVersion,
      readVersion: turn.readVersion,
      writeVersion: turn.writeVersion,
      blockedByTurnIds: turn.blockedByTurnIds,
      reason: turn.reason,
    },
  }
}

export async function emitSseMessage(
  writer: EventStreamWriter,
  message: AgentMessage
): Promise<void> {
  const eventName = message.type || 'message'
  await Promise.resolve(writer.write(`event: ${eventName}\n`))
  await Promise.resolve(writer.write(`data: ${JSON.stringify(message)}\n\n`))
}
