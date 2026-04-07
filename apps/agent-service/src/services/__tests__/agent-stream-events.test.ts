import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TurnRecord } from '../../types/turn-runtime'
import {
  createDoneMessage,
  createErrorMessage,
  createSessionMessage,
  createTurnStateMessage,
  emitSseMessage,
} from '../agent-stream-events'

function createTurn(): TurnRecord {
  return {
    id: 'turn_stream_1',
    taskId: 'task_stream_1',
    runId: 'run_stream_1',
    prompt: 'Plan the task',
    state: 'planning',
    readVersion: 2,
    writeVersion: null,
    blockedByTurnIds: ['turn_dep_1'],
    reason: 'Waiting for dependent turns',
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('agent-stream-events', () => {
  it('creates session, error, and done messages with stable timestamps', () => {
    const now = new Date('2026-03-21T14:00:00.000Z')
    const createId = (prefix: string) => `${prefix}_stable`

    expect(createSessionMessage('run_stream_1', { createId, now })).toEqual({
      id: 'msg_stable',
      type: 'session',
      sessionId: 'run_stream_1',
      timestamp: now.getTime(),
    })

    expect(createErrorMessage('boom', { createId, now })).toEqual({
      id: 'msg_stable',
      type: 'error',
      errorMessage: 'boom',
      timestamp: now.getTime(),
    })

    expect(createDoneMessage({ createId, now })).toEqual({
      id: 'msg_stable',
      type: 'done',
      timestamp: now.getTime(),
    })
  })

  it('creates turn_state message from turn snapshot and runtime version', () => {
    const now = new Date('2026-03-21T14:01:00.000Z')
    const createId = (prefix: string) => `${prefix}_turn_state`

    expect(createTurnStateMessage(createTurn(), 7, { createId, now })).toEqual({
      id: 'msg_turn_state',
      type: 'turn_state',
      timestamp: now.getTime(),
      turn: {
        taskId: 'task_stream_1',
        turnId: 'turn_stream_1',
        state: 'planning',
        taskVersion: 7,
        readVersion: 2,
        writeVersion: null,
        blockedByTurnIds: ['turn_dep_1'],
        reason: 'Waiting for dependent turns',
      },
    })
  })

  it('writes SSE event and data lines for messages', async () => {
    const chunks: string[] = []
    const message: AgentMessage = {
      id: 'msg_emit_1',
      type: 'done',
      timestamp: 123,
    }

    await emitSseMessage(
      {
        write: (chunk: string) => {
          chunks.push(chunk)
        },
      },
      message
    )

    expect(chunks).toEqual([
      'event: done\n',
      `data: ${JSON.stringify(message)}\n\n`,
    ])
  })
})
