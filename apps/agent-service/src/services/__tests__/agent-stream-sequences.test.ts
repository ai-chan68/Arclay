import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TurnRecord, TurnTransitionResult } from '../../types/turn-runtime'
import {
  createDoneMessage,
  createTurnStateMessage,
  emitSseMessage,
} from '../agent-stream-events'
import {
  emitBlockedTurnAndDone,
  emitMessages,
  emitMessagesAndTurnTransition,
  emitMessagesAndDone,
  emitTurnTransitionAndMessages,
  emitTurnTransitionAndDone,
  emitMessagesTurnTransitionAndDone,
} from '../agent-stream-sequences'

interface SseEvent {
  event: string
  data: Record<string, unknown> | null
}

function parseSseEvents(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event:'))
      const dataLine = lines.find((line) => line.startsWith('data:'))
      const event = eventLine ? eventLine.slice(6).trim() : ''
      const payload = dataLine ? dataLine.slice(5).trim() : ''
      return {
        event,
        data: payload ? JSON.parse(payload) as Record<string, unknown> : null,
      }
    })
}

function createTurn(state: TurnRecord['state']): TurnRecord {
  return {
    id: `turn_${state}`,
    taskId: 'task_stream_seq',
    runId: 'run_stream_seq',
    prompt: 'Plan the task',
    state,
    readVersion: 1,
    writeVersion: null,
    blockedByTurnIds: state === 'blocked' ? ['turn_dep_1'] : [],
    reason: state === 'blocked' ? 'Waiting for dependent turns: turn_dep_1' : null,
    createdAt: 1,
    updatedAt: 2,
  }
}

function createTransition(turn: TurnRecord): TurnTransitionResult {
  return {
    status: 'ok',
    turn,
    runtime: null,
  }
}

function createWriter() {
  const chunks: string[] = []
  return {
    chunks,
    writer: {
      write(chunk: string) {
        chunks.push(chunk)
      },
    },
  }
}

async function emitTurnState(
  writer: { write: (chunk: string) => unknown },
  result: TurnTransitionResult | { turn: TurnRecord | null }
) {
  if (!result.turn) return
  await emitSseMessage(
    writer,
    createTurnStateMessage(result.turn, 3, {
      createId: () => 'msg_turn_state',
      now: new Date('2026-03-21T15:00:00.000Z'),
    })
  )
}

describe('agent-stream-sequences', () => {
  it('emits messages without any extra events', async () => {
    const { chunks, writer } = createWriter()
    const errorMessage: AgentMessage = {
      id: 'msg_error_only',
      type: 'error',
      errorMessage: 'only error',
      timestamp: 0,
    }

    await emitMessages(writer, {
      messages: [errorMessage],
    })

    expect(parseSseEvents(chunks.join(''))).toEqual([
      { event: 'error', data: errorMessage as unknown as Record<string, unknown> },
    ])
  })

  it('emits messages followed by done', async () => {
    const { chunks, writer } = createWriter()
    const errorMessage: AgentMessage = {
      id: 'msg_error',
      type: 'error',
      errorMessage: 'boom',
      timestamp: 1,
    }

    await emitMessagesAndDone(writer, {
      messages: [errorMessage],
      createId: () => 'msg_done',
      now: new Date('2026-03-21T15:01:00.000Z'),
    })

    expect(parseSseEvents(chunks.join(''))).toEqual([
      { event: 'error', data: errorMessage as unknown as Record<string, unknown> },
      {
        event: 'done',
        data: createDoneMessage({
          createId: () => 'msg_done',
          now: new Date('2026-03-21T15:01:00.000Z'),
        }) as unknown as Record<string, unknown>,
      },
    ])
  })

  it('emits messages, then turn transition, then done', async () => {
    const { chunks, writer } = createWriter()
    const clarificationMessage: AgentMessage = {
      id: 'msg_clarification',
      type: 'clarification_request',
      role: 'assistant',
      content: '请提供项目路径。',
      timestamp: 2,
    }

    await emitMessagesTurnTransitionAndDone(writer, {
      messages: [clarificationMessage],
      turnTransition: createTransition(createTurn('awaiting_clarification')),
      emitTurnState,
      createId: () => 'msg_done_seq',
      now: new Date('2026-03-21T15:02:00.000Z'),
    })

    const events = parseSseEvents(chunks.join(''))
    expect(events.map((event) => event.event)).toEqual([
      'clarification_request',
      'turn_state',
      'done',
    ])
  })

  it('emits blocked fallback turn, blocked message, and done', async () => {
    const { chunks, writer } = createWriter()
    const blockedTurn = createTurn('blocked')
    const blockedMessage: AgentMessage = {
      id: 'msg_blocked_text',
      type: 'text',
      role: 'assistant',
      content: '当前回合正在等待前序回合完成。',
      timestamp: 3,
    }

    await emitBlockedTurnAndDone(writer, {
      transitions: [],
      fallbackTurn: blockedTurn,
      blockedMessage,
      emitTurnState,
      createId: () => 'msg_done_blocked',
      now: new Date('2026-03-21T15:03:00.000Z'),
    })

    const events = parseSseEvents(chunks.join(''))
    expect(events.map((event) => event.event)).toEqual([
      'turn_state',
      'text',
      'done',
    ])
  })

  it('emits turn transition followed by done', async () => {
    const { chunks, writer } = createWriter()

    await emitTurnTransitionAndDone(writer, {
      turnTransition: createTransition(createTurn('completed')),
      emitTurnState,
      createId: () => 'msg_done_completed',
      now: new Date('2026-03-21T15:04:00.000Z'),
    })

    const events = parseSseEvents(chunks.join(''))
    expect(events.map((event) => event.event)).toEqual([
      'turn_state',
      'done',
    ])
  })

  it('emits messages followed by turn transition without done', async () => {
    const { chunks, writer } = createWriter()
    const clarificationMessage: AgentMessage = {
      id: 'msg_pause_clarification',
      type: 'clarification_request',
      role: 'assistant',
      content: '请先完成登录后回复我继续。',
      timestamp: 4,
    }

    await emitMessagesAndTurnTransition(writer, {
      messages: [clarificationMessage],
      turnTransition: createTransition(createTurn('awaiting_clarification')),
      emitTurnState,
    })

    const events = parseSseEvents(chunks.join(''))
    expect(events.map((event) => event.event)).toEqual([
      'clarification_request',
      'turn_state',
    ])
  })

  it('emits turn transition followed by messages without done', async () => {
    const { chunks, writer } = createWriter()
    const errorMessage: AgentMessage = {
      id: 'msg_failed',
      type: 'error',
      errorMessage: 'planning failed',
      timestamp: 5,
    }

    await emitTurnTransitionAndMessages(writer, {
      turnTransition: createTransition(createTurn('failed')),
      messages: [errorMessage],
      emitTurnState,
    })

    const events = parseSseEvents(chunks.join(''))
    expect(events.map((event) => event.event)).toEqual([
      'turn_state',
      'error',
    ])
  })
})
