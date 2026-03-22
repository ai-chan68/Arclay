import path from 'path'
import { describe, expect, it } from 'vitest'

import type { AgentMessage, TaskPlan } from '@shared-types'
import {
  buildExecutionBlockerCandidate,
  detectBlockedArtifactPath,
  detectIncompleteExecution,
  shouldTreatMaxTurnsAsInterrupted,
  type ExecutionCompletionSummary,
} from '../execution-completion'

function createPlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    id: overrides?.id || 'plan_exec_completion_test',
    goal: overrides?.goal || '查询订单并返回结果',
    steps: overrides?.steps || [
      { id: 'step_1', description: '打开订单页面', status: 'pending' },
      { id: 'step_2', description: '提取订单结果并输出', status: 'pending' },
    ],
    createdAt: overrides?.createdAt || new Date(),
    notes: overrides?.notes,
  }
}

function createSummary(overrides?: Partial<ExecutionCompletionSummary>): ExecutionCompletionSummary {
  return {
    toolUseCount: 0,
    toolResultCount: 0,
    meaningfulToolUseCount: 0,
    browserToolUseCount: 0,
    browserNavigationCount: 0,
    browserInteractionCount: 0,
    browserSnapshotCount: 0,
    browserScreenshotCount: 0,
    browserEvalCount: 0,
    assistantTextCount: 0,
    meaningfulAssistantTextCount: 0,
    preambleAssistantTextCount: 0,
    resultMessageCount: 0,
    latestTodoSnapshot: null,
    pendingInteractionCount: 0,
    blockerCandidate: null,
    blockedArtifactPath: null,
    providerResultSubtype: null,
    providerStopReason: null,
    ...overrides,
  }
}

describe('detectBlockedArtifactPath', () => {
  it('recognizes task_blocked_summary.md writes as blocked execution artifacts', () => {
    const message: AgentMessage = {
      id: 'tool_use_blocked_summary',
      type: 'tool_use',
      toolName: 'Write',
      toolInput: {
        file_path: path.join('/tmp', 'sessions', 'task_1', 'task_blocked_summary.md'),
      },
      timestamp: 1,
    }

    expect(detectBlockedArtifactPath(message)).toContain('task_blocked_summary.md')
  })
})

describe('buildExecutionBlockerCandidate', () => {
  it('treats TodoWrite login blockers as user-action pauses', () => {
    const message: AgentMessage = {
      id: 'todo_login_blocker',
      type: 'tool_use',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          {
            id: 'todo_1',
            content: '等待用户完成登录并授权',
            status: 'in_progress',
          },
        ],
      },
      timestamp: 1,
    }

    const candidate = buildExecutionBlockerCandidate(message)
    expect(candidate).toBeTruthy()
    expect(candidate?.reason).toContain('登录')
    expect(candidate?.userMessage).toContain('请处理后回复我继续')
  })
})

describe('shouldTreatMaxTurnsAsInterrupted', () => {
  it('keeps max-turns runs resumable when meaningful progress exists', () => {
    expect(
      shouldTreatMaxTurnsAsInterrupted(
        createSummary({
          providerResultSubtype: 'max_turns',
          meaningfulToolUseCount: 1,
        })
      )
    ).toBe(true)
  })
})

describe('detectIncompleteExecution', () => {
  it('fails execution when a blocked summary artifact is produced instead of final completion', () => {
    const reason = detectIncompleteExecution(
      createSummary({
        blockedArtifactPath: '/tmp/sessions/task_1/task_blocked_summary.md',
      }),
      '继续执行任务',
      createPlan()
    )

    expect(reason).toContain('task_blocked_summary.md')
  })

  it('fails execution when todo steps remain incomplete', () => {
    const reason = detectIncompleteExecution(
      createSummary({
        latestTodoSnapshot: {
          total: 2,
          completed: 1,
          inProgress: 1,
          pending: 0,
          failed: 0,
          currentItems: ['提取订单结果并输出'],
        },
      }),
      '查询订单并返回结果',
      createPlan()
    )

    expect(reason).toBe('Execution ended before completing all planned steps.')
  })
})
