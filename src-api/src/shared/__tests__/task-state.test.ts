import { describe, expect, it } from 'vitest'

import type { AgentMessage } from '@shared-types'
import {
  deriveStatusFromMessages,
  isProcessAssistantResponse,
  isTaskActivelyRunning,
} from '../../../../src/shared/lib/task-state'

function createMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    type: partial.type || 'text',
    timestamp: partial.timestamp || Date.now(),
    ...partial,
  }
}

describe('deriveStatusFromMessages', () => {
  it('ignores done markers from previous turns when latest turn is still in progress', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'first turn', timestamp: 1 }),
      createMessage({ id: 'd1', type: 'done', timestamp: 2 }),
      createMessage({ id: 'u2', type: 'user', role: 'user', content: 'second turn', timestamp: 3 }),
      createMessage({ id: 't2', type: 'tool_use', toolName: 'web-search', timestamp: 4 }),
    ]

    expect(deriveStatusFromMessages(messages, false)).toBe('running')
  })

  it('marks completed when latest turn contains a done marker', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'current turn', timestamp: 1 }),
      createMessage({
        id: 'a1',
        type: 'text',
        role: 'assistant',
        content: '这是最终分析：股价下跌主要受业绩指引下修和行业情绪走弱影响。',
        timestamp: 2,
      }),
      createMessage({ id: 'd1', type: 'done', timestamp: 3 }),
    ]

    expect(deriveStatusFromMessages(messages, false)).toBe('completed')
  })

  it('does not mark completed when latest turn only has placeholder assistant text and done marker', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'current turn', timestamp: 1 }),
      createMessage({
        id: 'a1',
        type: 'text',
        role: 'assistant',
        content: 'I understand the request. Let me analyze the information and proceed with the appropriate action.',
        timestamp: 2,
      }),
      createMessage({ id: 'd1', type: 'done', timestamp: 2 }),
    ]

    expect(deriveStatusFromMessages(messages, false)).toBe('running')
  })

  it('does not mark completed when latest turn only has process text, tools, and done marker', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'current turn', timestamp: 1 }),
      createMessage({
        id: 'a1',
        type: 'text',
        role: 'assistant',
        content: '现在点击查询按钮。',
        timestamp: 2,
      }),
      createMessage({ id: 'tu1', type: 'tool_use', toolName: 'browser-click', timestamp: 3 }),
      createMessage({ id: 'tr1', type: 'tool_result', toolOutput: 'clicked', timestamp: 4 }),
      createMessage({ id: 'd1', type: 'done', timestamp: 5 }),
    ]

    expect(deriveStatusFromMessages(messages, false)).toBe('running')
  })
})

describe('isTaskActivelyRunning', () => {
  it('stops treating planning phase as active when a task error exists', () => {
    expect(
      isTaskActivelyRunning({
        phase: 'planning',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Claude Code process exited with code 1',
        },
      })
    ).toBe(false)
  })

  it('keeps approval and blocked phases active without an error', () => {
    expect(isTaskActivelyRunning({ phase: 'awaiting_approval', error: null })).toBe(true)
    expect(isTaskActivelyRunning({ phase: 'blocked', error: null })).toBe(true)
  })
})

describe('isProcessAssistantResponse', () => {
  it('recognizes english execution preamble text', () => {
    expect(
      isProcessAssistantResponse("I'll start by setting up the todo list and then execute the plan step by step.")
    ).toBe(true)
    expect(
      isProcessAssistantResponse('Let me navigate to the target page first.')
    ).toBe(true)
    expect(
      isProcessAssistantResponse("I see — I'm operating as a Claude, an AI assistant by Anthropic.")
    ).toBe(true)
  })
})
