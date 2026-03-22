import { describe, expect, it } from 'vitest'

import type { AgentMessage, PendingQuestion, PermissionRequest } from '@shared-types'
import {
  getLatestRuntimeState,
  getMessagesForTurn,
  groupIntoTurns,
} from '../../../../src/shared/lib/task-message-turns'

function createMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    type: partial.type || 'text',
    timestamp: partial.timestamp || Date.now(),
    ...partial,
  }
}

describe('groupIntoTurns', () => {
  it('keeps clarification requests attached to their original turn for historical review', () => {
    const question: PendingQuestion = {
      id: 'q_hist_1',
      question: '请补充订单号后继续。',
      allowFreeText: true,
      source: 'clarification',
    }

    const turns = groupIntoTurns([
      createMessage({ id: 'u1', type: 'user', role: 'user', content: '帮我查订单', timestamp: 1 }),
      createMessage({
        id: 'c1',
        type: 'clarification_request',
        role: 'assistant',
        content: question.question,
        clarification: question,
        question,
        timestamp: 2,
      }),
      createMessage({
        id: 'ts1',
        type: 'turn_state',
        turn: {
          taskId: 'task_hist_1',
          turnId: 'turn_hist_1',
          state: 'awaiting_clarification',
          taskVersion: 0,
          readVersion: 0,
        },
        timestamp: 3,
      }),
      createMessage({ id: 'd1', type: 'done', timestamp: 4 }),
    ], false)

    expect(turns).toHaveLength(1)
    expect(turns[0].pendingQuestion).toMatchObject({ id: 'q_hist_1' })
    expect(getLatestRuntimeState(turns[0])).toBe('awaiting_clarification')
    expect(getMessagesForTurn(turns[0]).some((message) => message.type === 'clarification_request')).toBe(true)
  })

  it('keeps permission requests attached to their execution turn', () => {
    const permission: PermissionRequest = {
      id: 'perm_hist_1',
      type: 'command_exec',
      title: '允许执行命令',
      description: '需要执行受限命令继续。',
    }

    const turns = groupIntoTurns([
      createMessage({ id: 'u1', type: 'user', role: 'user', content: '继续部署', timestamp: 1 }),
      createMessage({
        id: 'p1',
        type: 'permission_request',
        permission,
        timestamp: 2,
      }),
      createMessage({
        id: 'ts1',
        type: 'turn_state',
        turn: {
          taskId: 'task_hist_perm_1',
          turnId: 'turn_hist_perm_1',
          state: 'executing',
          taskVersion: 1,
          readVersion: 0,
        },
        timestamp: 3,
      }),
    ], false)

    expect(turns).toHaveLength(1)
    expect(turns[0].pendingPermission).toMatchObject({ id: 'perm_hist_1' })
    expect(getMessagesForTurn(turns[0]).some((message) => message.type === 'permission_request')).toBe(true)
  })
})
