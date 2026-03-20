import { describe, expect, it } from 'vitest'

import type { AgentMessage } from '@shared-types'
import { getPreferredFailureDetail } from '../../../../src/shared/lib/agent-error-display'
import { getWorkspaceDisplayState } from '../../../../src/shared/lib/task-turn-display'

function createMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    type: partial.type || 'text',
    timestamp: partial.timestamp || Date.now(),
    ...partial,
  }
}

describe('getPreferredFailureDetail', () => {
  it('prefers assistant API error text over generic custom api errors', () => {
    const messages: AgentMessage[] = [
      createMessage({ id: 'u1', type: 'user', role: 'user', content: 'open page', timestamp: 1 }),
      createMessage({
        id: 'a1',
        type: 'text',
        role: 'assistant',
        content: 'API Error: 402 {"type":"error","error":{"type":"daily_limit_reached"}}',
        timestamp: 2,
      }),
      createMessage({
        id: 'e1',
        type: 'error',
        errorMessage: '__CUSTOM_API_ERROR__|https://yunyi.rdzhvip.com/claude',
        timestamp: 3,
      }),
    ]

    expect(
      getPreferredFailureDetail(messages, '__CUSTOM_API_ERROR__|https://yunyi.rdzhvip.com/claude')
    ).toBe('API Error: 402 {"type":"error","error":{"type":"daily_limit_reached"}}')
  })

  it('humanizes generic custom api errors when no richer detail exists', () => {
    expect(
      getPreferredFailureDetail([], '__CUSTOM_API_ERROR__|https://yunyi.rdzhvip.com/claude')
    ).toBe('自定义 Claude API 调用失败：https://yunyi.rdzhvip.com/claude')
  })
})

describe('getWorkspaceDisplayState', () => {
  it('keeps the plan section visible for failed turns that already have a plan', () => {
    expect(
      getWorkspaceDisplayState({
        isStopped: false,
        isRunning: false,
        taskStatus: 'error',
        hasError: true,
        isLatestTurn: true,
        isAwaitingApproval: false,
        isAwaitingClarification: false,
        hasPlanForApproval: false,
        hasExecutionTrace: false,
        hasResultMessage: true,
        artifactsCount: 0,
        hasPendingPermission: false,
        hasPendingQuestion: false,
        hasLatestApprovalTerminal: false,
        hasPlan: true,
      })
    ).toEqual({
      phase: 'failed',
      showPlanSection: true,
    })
  })
})
