import { describe, expect, it } from 'vitest'

import { buildTurnDisplayModel } from '../../../../web/shared/lib/task-turn-display'

describe('buildTurnDisplayModel interop with historical turns', () => {
  it('does not let latest-turn stopped or clarification state hide a historical successful turn', () => {
    const model = buildTurnDisplayModel({
      isStopped: true,
      isRunning: false,
      taskStatus: 'stopped',
      hasError: false,
      isLatestTurn: false,
      runtimeState: null,
      isAwaitingApproval: false,
      isAwaitingClarification: true,
      hasPlanForApproval: false,
      hasExecutionTrace: true,
      hasResultMessage: true,
      artifacts: [],
      hasPendingPermission: false,
      hasPendingQuestion: false,
      hasLatestApprovalTerminal: false,
      hasPlan: true,
      isTurnComplete: true,
      resultMessage: {
        content: '历史回合成功输出',
        isTemporary: false,
      },
    })

    expect(model.phase).toBe('execution')
    expect(model.visibleResult.kind).toBe('text')
    expect(model.visibleResult.text).toBe('历史回合成功输出')
  })

  it('still shows stopped state for the latest turn', () => {
    const model = buildTurnDisplayModel({
      isStopped: true,
      isRunning: false,
      taskStatus: 'stopped',
      hasError: false,
      isLatestTurn: true,
      runtimeState: null,
      isAwaitingApproval: false,
      isAwaitingClarification: false,
      hasPlanForApproval: false,
      hasExecutionTrace: false,
      hasResultMessage: false,
      artifacts: [],
      hasPendingPermission: false,
      hasPendingQuestion: false,
      hasLatestApprovalTerminal: false,
      hasPlan: false,
      isTurnComplete: false,
      resultMessage: null,
    })

    expect(model.phase).toBe('stopped')
    expect(model.visibleResult.kind).toBe('none')
  })
})
