import { describe, expect, it } from 'vitest'

import type { AgentMessage } from '@shared-types'
import type { Artifact } from '../../../../src/shared/types/artifacts'
import * as taskTurnDisplay from '../../../../src/shared/lib/task-turn-display'

function createArtifact(partial: Partial<Artifact>): Artifact {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    name: partial.name || 'artifact.txt',
    type: partial.type || 'text',
    ...partial,
  }
}

function createMessage(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    type: partial.type || 'text',
    timestamp: partial.timestamp || Date.now(),
    ...partial,
  }
}

describe('buildTurnDisplayModel', () => {
  it('keeps final output hidden while the turn is still running', () => {
    const resultMessage = createMessage({
      id: 'r1',
      type: 'result',
      role: 'assistant',
      content: '最终报告已经生成。',
      isTemporary: false,
      timestamp: 1,
    })

    const artifacts = [
      createArtifact({
        id: 'code-file',
        name: 'report.ts',
        type: 'code',
        path: '/tmp/report.ts',
      }),
      createArtifact({
        id: 'final-pdf',
        name: 'report.pdf',
        type: 'pdf',
        path: '/tmp/report.pdf',
      }),
    ]

    const buildTurnDisplayModel = (taskTurnDisplay as Record<string, unknown>).buildTurnDisplayModel as
      | ((input: Record<string, unknown>) => Record<string, unknown>)
      | undefined

    expect(buildTurnDisplayModel).toBeTypeOf('function')

    const model = buildTurnDisplayModel!({
      isStopped: false,
      isRunning: true,
      taskStatus: 'running',
      hasError: false,
      isLatestTurn: true,
      isAwaitingApproval: false,
      isAwaitingClarification: false,
      hasPlanForApproval: false,
      hasExecutionTrace: true,
      hasResultMessage: true,
      artifacts,
      hasPendingPermission: false,
      hasPendingQuestion: false,
      hasLatestApprovalTerminal: false,
      hasPlan: true,
      isTurnComplete: false,
      resultMessage,
    })

    expect(model.availableResult).toMatchObject({
      kind: 'mixed',
      text: '最终报告已经生成。',
      previewTargetId: 'final-pdf',
    })
    expect(model.visibleResult).toMatchObject({
      kind: 'none',
      artifacts: [],
    })
  })

  it('ignores temporary assistant text when deciding final text output', () => {
    const resultMessage = createMessage({
      id: 't1',
      type: 'text',
      role: 'assistant',
      content: '我先检查一下文件结构……',
      isTemporary: true,
      timestamp: 1,
    })

    const buildTurnDisplayModel = (taskTurnDisplay as Record<string, unknown>).buildTurnDisplayModel as
      | ((input: Record<string, unknown>) => Record<string, unknown>)
      | undefined

    expect(buildTurnDisplayModel).toBeTypeOf('function')

    const model = buildTurnDisplayModel!({
      isStopped: false,
      isRunning: false,
      taskStatus: 'completed',
      hasError: false,
      isLatestTurn: true,
      isAwaitingApproval: false,
      isAwaitingClarification: false,
      hasPlanForApproval: false,
      hasExecutionTrace: true,
      hasResultMessage: true,
      artifacts: [],
      hasPendingPermission: false,
      hasPendingQuestion: false,
      hasLatestApprovalTerminal: false,
      hasPlan: true,
      isTurnComplete: true,
      resultMessage,
    })

    expect(model.availableResult).toMatchObject({
      kind: 'none',
      text: undefined,
      artifacts: [],
    })
    expect(model.visibleResult).toMatchObject({
      kind: 'none',
      text: undefined,
      artifacts: [],
    })
  })

  it('keeps final output hidden while a pending question still needs user input', () => {
    const resultMessage = createMessage({
      id: 'r1',
      type: 'result',
      role: 'assistant',
      content: 'OMS统一订单号：1234567890',
      isTemporary: false,
      timestamp: 1,
    })

    const buildTurnDisplayModel = (taskTurnDisplay as Record<string, unknown>).buildTurnDisplayModel as
      | ((input: Record<string, unknown>) => Record<string, unknown>)
      | undefined

    expect(buildTurnDisplayModel).toBeTypeOf('function')

    const model = buildTurnDisplayModel!({
      isStopped: false,
      isRunning: false,
      taskStatus: 'running',
      hasError: false,
      isLatestTurn: true,
      isAwaitingApproval: false,
      isAwaitingClarification: true,
      hasPlanForApproval: false,
      hasExecutionTrace: true,
      hasResultMessage: true,
      artifacts: [],
      hasPendingPermission: false,
      hasPendingQuestion: true,
      hasLatestApprovalTerminal: false,
      hasPlan: true,
      isTurnComplete: true,
      resultMessage,
    })

    expect(model.availableResult).toMatchObject({
      kind: 'text',
      text: 'OMS统一订单号：1234567890',
    })
    expect(model.visibleResult).toMatchObject({
      kind: 'none',
      artifacts: [],
    })
  })
})
