import { describe, expect, it } from 'vitest'

import type { AgentMessage } from '@shared-types'
import {
  deriveStatusFromMessages,
  isProcessAssistantResponse,
  isTaskActivelyRunning,
  isValidPhaseTransition,
  mapTurnStateToPhase,
  resolveTaskStatus,
  shouldPollRuntimePhase,
  shouldApplyTerminalExecutionFailure,
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

  it('does not mark completed when latest turn is paused for a clarification request', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'current turn', timestamp: 1 }),
      createMessage({
        id: 'a1',
        type: 'text',
        role: 'assistant',
        content: '查询结果已清晰显示！现在更新状态并记录结果。',
        timestamp: 2,
      }),
      createMessage({
        id: 'q1',
        type: 'clarification_request',
        role: 'assistant',
        content: '当前页面仍停留在登录/认证流程，请先完成登录后回复我继续。',
        timestamp: 3,
      }),
      createMessage({ id: 'd1', type: 'done', timestamp: 4 }),
    ]

    expect(deriveStatusFromMessages(messages, false)).toBe('running')
  })

  it('keeps latest turn completed when an earlier execution error is followed by a final result', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'query oms order', timestamp: 1 }),
      createMessage({
        id: 'e1',
        type: 'error',
        errorMessage: 'Tool temporarily failed while querying.',
        timestamp: 2,
      }),
      createMessage({
        id: 'r1',
        type: 'result',
        role: 'assistant',
        content: 'OMS统一订单号：645434699',
        timestamp: 3,
      }),
      createMessage({ id: 'd1', type: 'done', timestamp: 4 }),
    ]

    expect(deriveStatusFromMessages(messages, false)).toBe('completed')
  })
})

describe('isTaskActivelyRunning', () => {
  it('treats analyzing as an active runtime phase', () => {
    expect(isTaskActivelyRunning({ phase: 'analyzing' as any, error: null })).toBe(true)
  })

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

describe('isValidPhaseTransition', () => {
  it('allows transition from idle to analyzing before planning', () => {
    expect(isValidPhaseTransition('idle' as any, 'analyzing' as any)).toBe(true)
    expect(isValidPhaseTransition('analyzing' as any, 'planning' as any)).toBe(true)
  })
})

describe('mapTurnStateToPhase', () => {
  it('maps active turn states to matching interactive phases', () => {
    expect(mapTurnStateToPhase('analyzing' as any)).toBe('analyzing')
    expect(mapTurnStateToPhase('planning' as any)).toBe('planning')
    expect(mapTurnStateToPhase('awaiting_approval' as any)).toBe('awaiting_approval')
    expect(mapTurnStateToPhase('awaiting_clarification' as any)).toBe('awaiting_clarification')
    expect(mapTurnStateToPhase('executing' as any)).toBe('executing')
    expect(mapTurnStateToPhase('blocked' as any)).toBe('blocked')
  })

  it('maps terminal turn states back to idle phase', () => {
    expect(mapTurnStateToPhase('completed' as any)).toBe('idle')
    expect(mapTurnStateToPhase('failed' as any)).toBe('idle')
    expect(mapTurnStateToPhase('cancelled' as any)).toBe('idle')
  })
})

describe('shouldPollRuntimePhase', () => {
  it('keeps runtime recovery polling enabled during analyzing and planning', () => {
    expect(shouldPollRuntimePhase('analyzing' as any)).toBe(true)
    expect(shouldPollRuntimePhase('planning' as any)).toBe(true)
  })

  it('does not poll when the frontend is idle', () => {
    expect(shouldPollRuntimePhase('idle' as any)).toBe(false)
  })
})

describe('resolveTaskStatus', () => {
  it('repairs a persisted error status when recovered messages show the latest turn completed', () => {
    expect(
      resolveTaskStatus({
        currentStatus: 'error',
        derivedStatus: 'completed',
        isRunning: false,
        interruptedByApproval: false,
        manuallyStopped: false,
        statusFromTurnState: null,
      })
    ).toBe('completed')
  })

  it('keeps a persisted stopped status when the task was manually stopped', () => {
    expect(
      resolveTaskStatus({
        currentStatus: 'stopped',
        derivedStatus: 'completed',
        isRunning: false,
        interruptedByApproval: false,
        manuallyStopped: true,
        statusFromTurnState: null,
      })
    ).toBe('stopped')
  })
})

describe('shouldApplyTerminalExecutionFailure', () => {
  it('does not treat in-flight tool errors as terminal execution failure', () => {
    expect(
      shouldApplyTerminalExecutionFailure({
        hasExecutionError: true,
        isRunning: true,
        isTurnComplete: false,
      })
    ).toBe(false)
  })

  it('treats completed failed turns as terminal execution failure', () => {
    expect(
      shouldApplyTerminalExecutionFailure({
        hasExecutionError: true,
        isRunning: false,
        isTurnComplete: true,
      })
    ).toBe(true)
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
