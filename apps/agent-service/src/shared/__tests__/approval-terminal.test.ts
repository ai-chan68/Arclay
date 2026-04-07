import { describe, expect, it } from 'vitest'

import type { AgentMessage } from '@shared-types'
import {
  buildApprovalTerminalMessage,
  hasApprovalTerminalMessage,
} from '../../../../src/shared/lib/approval-terminal'

function createMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    type: partial.type || 'text',
    timestamp: partial.timestamp || Date.now(),
    ...partial,
  }
}

describe('approval terminal history helpers', () => {
  it('builds a user-visible history message for interrupted approval terminals', () => {
    const message = buildApprovalTerminalMessage({
      id: 'terminal_1',
      kind: 'question',
      status: 'orphaned',
      reason: null,
      updatedAt: 123,
    })

    expect(message.content).toContain('审批状态: 会话已失效')
    expect(message.metadata).toMatchObject({
      approvalTerminalId: 'terminal_1',
      approvalTerminalStatus: 'orphaned',
      approvalTerminalKind: 'question',
    })
  })

  it('detects when the terminal has already been materialized into message history', () => {
    const messages: AgentMessage[] = [
      createMessage({
        id: 'msg_1',
        type: 'text',
        role: 'assistant',
        content: '审批状态: 已拒绝。审批已被拒绝，如仍需继续请重新发起任务。',
        metadata: {
          approvalTerminalId: 'terminal_2',
          approvalTerminalStatus: 'rejected',
        },
      }),
    ]

    expect(hasApprovalTerminalMessage(messages, 'terminal_2')).toBe(true)
    expect(hasApprovalTerminalMessage(messages, 'terminal_3')).toBe(false)
  })
})
