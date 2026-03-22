import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { ExecutionCompletionSummary } from '../execution-completion'
import { processExecutionStreamMessage } from '../execution-stream-processing'

function createSummary(
  overrides: Partial<ExecutionCompletionSummary> = {}
): ExecutionCompletionSummary {
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

describe('processExecutionStreamMessage', () => {
  it('captures TodoWrite progress, blocker candidate, and audit entries', async () => {
    const executionSummary = createSummary()
    const appendProgressEntry = vi.fn(async () => {})
    const message: AgentMessage = {
      id: 'todo_msg',
      type: 'tool_use',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          {
            id: '1',
            content: '等待用户完成登录认证',
            status: 'in_progress',
          },
        ],
      },
      timestamp: 1,
    }

    const result = await processExecutionStreamMessage({
      message,
      executionSummary,
      browserAutomationIntent: false,
      progressPath: '/tmp/progress.md',
      appendProgressEntry,
      now: new Date('2026-03-21T16:00:00.000Z'),
    })

    expect(result.shouldForward).toBe(true)
    expect(result.executionFailed).toBe(false)
    expect(result.blockerCandidate?.userMessage).toContain('执行被阻塞')
    expect(executionSummary.toolUseCount).toBe(1)
    expect(executionSummary.meaningfulToolUseCount).toBe(0)
    expect(executionSummary.latestTodoSnapshot?.inProgress).toBe(1)
    expect(appendProgressEntry).toHaveBeenCalledTimes(2)
    expect(appendProgressEntry).toHaveBeenNthCalledWith(1, '/tmp/progress.md', [
      '### Progress Update (2026-03-21T16:00:00.000Z)',
      '- Completed: 0/1',
      '- In Progress: 1',
      '- Pending: 0',
      '- Failed: 0',
      '- Current Step: 等待用户完成登录认证',
    ])
    expect(appendProgressEntry).toHaveBeenNthCalledWith(2, '/tmp/progress.md', [
      '### Tool Trace (2026-03-21T16:00:00.000Z)',
      '- tool_use TodoWrite: todos=[{\"id\":\"1\",\"content\":\"等待用户完成登录认证\",\"status\":\"in_progress\"}]',
    ])
  })

  it('counts browser automation tool usage by kind', async () => {
    const executionSummary = createSummary()
    const appendProgressEntry = vi.fn(async () => {})
    const message: AgentMessage = {
      id: 'browser_nav',
      type: 'tool_use',
      toolName: 'mcp__chrome-devtools__navigate_page',
      toolInput: {
        url: 'https://example.com',
      },
      timestamp: 2,
    }

    const result = await processExecutionStreamMessage({
      message,
      executionSummary,
      browserAutomationIntent: true,
      progressPath: '/tmp/progress.md',
      appendProgressEntry,
      now: new Date('2026-03-21T16:01:00.000Z'),
    })

    expect(result.shouldForward).toBe(true)
    expect(executionSummary.toolUseCount).toBe(1)
    expect(executionSummary.meaningfulToolUseCount).toBe(1)
    expect(executionSummary.browserToolUseCount).toBe(1)
    expect(executionSummary.browserNavigationCount).toBe(1)
    expect(executionSummary.browserInteractionCount).toBe(0)
    expect(appendProgressEntry).toHaveBeenCalledTimes(1)
  })

  it('classifies assistant preamble text without counting it as meaningful progress', async () => {
    const executionSummary = createSummary()
    const appendProgressEntry = vi.fn(async () => {})
    const message: AgentMessage = {
      id: 'assistant_preamble',
      type: 'text',
      role: 'assistant',
      content: "I'll start by opening the target page.",
      timestamp: 3,
    }

    const result = await processExecutionStreamMessage({
      message,
      executionSummary,
      browserAutomationIntent: false,
      progressPath: '/tmp/progress.md',
      appendProgressEntry,
      now: new Date('2026-03-21T16:02:00.000Z'),
    })

    expect(result.shouldForward).toBe(true)
    expect(executionSummary.assistantTextCount).toBe(1)
    expect(executionSummary.preambleAssistantTextCount).toBe(1)
    expect(executionSummary.meaningfulAssistantTextCount).toBe(0)
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Tool Trace (2026-03-21T16:02:00.000Z)',
      "- assistant: I'll start by opening the target page.",
    ])
  })

  it('records error and provider completion metadata, and suppresses done forwarding', async () => {
    const appendProgressEntry = vi.fn(async () => {})

    const failingSummary = createSummary()
    const errorMessage: AgentMessage = {
      id: 'error_msg',
      type: 'error',
      errorMessage: 'Execution failed before completion.',
      timestamp: 4,
    }
    const errorResult = await processExecutionStreamMessage({
      message: errorMessage,
      executionSummary: failingSummary,
      browserAutomationIntent: false,
      progressPath: '/tmp/progress.md',
      appendProgressEntry,
      now: new Date('2026-03-21T16:03:00.000Z'),
    })

    expect(errorResult.shouldForward).toBe(true)
    expect(errorResult.executionFailed).toBe(true)
    expect(errorResult.executionFailureReason).toBe('Execution failed before completion.')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Error (2026-03-21T16:03:00.000Z)',
      '- Execution failed before completion.',
    ])

    appendProgressEntry.mockClear()

    const doneSummary = createSummary()
    const doneMessage: AgentMessage = {
      id: 'done_msg',
      type: 'done',
      timestamp: 5,
      metadata: {
        providerResultSubtype: 'max_turns',
        providerStopReason: 'Maximum turns reached',
        providerDurationMs: 1200,
      },
    }
    const doneResult = await processExecutionStreamMessage({
      message: doneMessage,
      executionSummary: doneSummary,
      browserAutomationIntent: false,
      progressPath: '/tmp/progress.md',
      appendProgressEntry,
      now: new Date('2026-03-21T16:04:00.000Z'),
    })

    expect(doneResult.shouldForward).toBe(false)
    expect(doneResult.executionFailed).toBe(false)
    expect(doneSummary.providerResultSubtype).toBe('max_turns')
    expect(doneSummary.providerStopReason).toBe('Maximum turns reached')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/progress.md', [
      '### Tool Trace (2026-03-21T16:04:00.000Z)',
      '- provider_result: subtype=max_turns, stopReason=Maximum turns reached, durationMs=1200',
    ])
  })
})
