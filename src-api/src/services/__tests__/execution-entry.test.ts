import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord } from '../../types/turn-runtime'
import { resolveExecutionEntry } from '../execution-entry'

function createPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id: 'plan_exec_entry',
    goal: '启动本地 web app 并验证可运行',
    steps: [
      {
        id: 'step_1',
        description: '运行 pnpm dev 并检查页面',
        status: 'pending',
      },
    ],
    createdAt: new Date('2026-03-22T14:00:00.000Z'),
    ...overrides,
  }
}

function createTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: 'turn_exec_entry',
    taskId: 'task_exec_entry',
    runId: 'run_exec_entry',
    prompt: '执行计划',
    state: 'executing',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('resolveExecutionEntry', () => {
  it('builds runtime-gated session input and preserves execute delegates', async () => {
    const activeTurn = createTurn()
    const executionStream = (async function* (): AsyncIterable<AgentMessage> {
      yield {
        id: 'msg_done',
        type: 'done',
        timestamp: 1,
      }
    })()
    const streamAgentExecution = vi.fn(() => executionStream)
    const capturePendingInteraction = vi.fn()
    const appendProgressEntry = vi.fn(async () => {})
    const processExecutionStreamMessage = vi.fn(async () => ({
      executionFailed: false,
      executionFailureReason: null,
      shouldForward: true,
    }))

    const result = resolveExecutionEntry({
      planId: 'plan_exec_entry',
      runId: 'run_exec_entry',
      prompt: '请启动本地 project 的 web app，run 起来并确认页面可访问。',
      plan: createPlan(),
      activeTurn,
      executionTaskId: 'task_exec_entry',
      effectiveWorkDir: '/tmp/workdir',
      executionWorkspaceDir: '/tmp/workdir/sessions/task_exec_entry',
      progressPath: '/tmp/workdir/sessions/task_exec_entry/progress.md',
      attachments: [{ name: 'spec.md', mimeType: 'text/markdown', data: 'ZGF0YQ==' }],
      providerName: 'claude',
      providerModel: 'sonnet',
      sandboxEnabled: true,
      runtimeMcpServers: {
        filesystem: {},
      },
      settingsMcpServers: {
        playwright: {},
      },
      streamAgentExecution,
      capturePendingInteraction,
      appendProgressEntry,
      processExecutionStreamMessage,
      formatPlanForExecution: (_plan, dir) => `formatted plan for ${dir}`,
      createObservation: vi.fn(),
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn(),
      emitMessage: vi.fn(async () => {}),
      emitMessages: vi.fn(async () => {}),
      emitTurnState: vi.fn(async () => {}),
      emitMessagesAndTurnTransition: vi.fn(async () => {}),
      emitTurnTransitionAndDone: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      deleteRun: vi.fn(),
      formatExecutionSummary: vi.fn(() => 'summary=ok'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      createId: (prefix) => `${prefix}_id`,
      buildRuntimeRepairPrompt: vi.fn(),
      now: () => new Date('2026-03-22T14:05:00.000Z'),
    })

    expect(result.promptText).toBe('请启动本地 project 的 web app，run 起来并确认页面可访问。')
    expect(result.executionPrompt).toContain('formatted plan for /tmp/workdir/sessions/task_exec_entry')
    expect(result.executionPrompt).toContain('Original request: 请启动本地 project 的 web app，run 起来并确认页面可访问。')
    expect(result.runtimeGateRequired).toBe(true)
    expect(result.browserAutomationIntent).toBe(false)
    expect(result.maxExecutionAttempts).toBe(2)
    expect(result.contextLogLines).toEqual([
      '### Execution Context (2026-03-22T14:05:00.000Z)',
      '- Provider: claude / sonnet',
      '- Browser Automation Intent: no',
      '- Runtime MCP Servers: filesystem',
      '- Settings MCP Servers: playwright',
      '- Sandbox Enabled: yes',
    ])
    expect(result.executionSummary.pendingInteractionCount).toBe(0)
    expect(result.executionSummary.latestTodoSnapshot).toBeNull()

    expect(result.streamExecution('repair prompt')).toBe(executionStream)
    expect(streamAgentExecution).toHaveBeenCalledWith(
      'repair prompt',
      'run_exec_entry',
      [{ name: 'spec.md', mimeType: 'text/markdown', data: 'ZGF0YQ==' }],
      undefined,
      {
        workDir: '/tmp/workdir',
        taskId: 'task_exec_entry',
      }
    )

    const message: AgentMessage = {
      id: 'msg_text',
      type: 'text',
      role: 'assistant',
      content: '执行中',
      timestamp: 2,
    }
    const observation = { commands: [], discoveredUrls: new Set(), passedHealthUrls: new Set(), portHints: new Set(), frontendCommandCount: 0, backendCommandCount: 0, portConflicts: [] }
    await result.processExecutionMessage(message, observation)

    expect(capturePendingInteraction).toHaveBeenCalledWith(message, {
      taskId: 'task_exec_entry',
      runId: 'run_exec_entry',
      providerSessionId: 'run_exec_entry',
    })
    expect(processExecutionStreamMessage).toHaveBeenCalledWith({
      message,
      executionSummary: result.executionSummary,
      browserAutomationIntent: false,
      progressPath: '/tmp/workdir/sessions/task_exec_entry/progress.md',
      appendProgressEntry,
    })
  })

  it('marks browser automation intent and warns when runtime browser mcp is unavailable', () => {
    const processExecutionStreamMessage = vi.fn(async () => ({
      executionFailed: false,
      executionFailureReason: null,
      shouldForward: true,
    }))

    const result = resolveExecutionEntry({
      planId: 'plan_exec_entry',
      runId: 'run_exec_entry',
      prompt: '请使用浏览器访问 https://yx.mail.netease.com，点击单选框并查询结果。',
      plan: createPlan({
        goal: '使用浏览器完成网页查询',
        steps: [
          {
            id: 'step_browser',
            description: '打开浏览器并点击页面控件',
            status: 'pending',
          },
        ],
      }),
      activeTurn: null,
      executionTaskId: 'task_exec_entry',
      effectiveWorkDir: '/tmp/workdir',
      executionWorkspaceDir: '/tmp/workdir/sessions/task_exec_entry',
      progressPath: '/tmp/workdir/sessions/task_exec_entry/progress.md',
      attachments: undefined,
      providerName: undefined,
      providerModel: undefined,
      sandboxEnabled: false,
      runtimeMcpServers: {
        filesystem: {},
      },
      settingsMcpServers: {
        playwright: {},
      },
      streamAgentExecution: vi.fn(),
      capturePendingInteraction: vi.fn(),
      appendProgressEntry: vi.fn(async () => {}),
      processExecutionStreamMessage,
      formatPlanForExecution: () => 'formatted',
      createObservation: vi.fn(),
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn(),
      emitMessage: vi.fn(async () => {}),
      emitMessages: vi.fn(async () => {}),
      emitTurnState: vi.fn(async () => {}),
      emitMessagesAndTurnTransition: vi.fn(async () => {}),
      emitTurnTransitionAndDone: vi.fn(async () => {}),
      captureQuestionRequest: vi.fn(),
      recountPendingInteractions: () => 0,
      markTurnAwaitingClarification: vi.fn(),
      markPlanOrphaned: vi.fn(),
      markPlanExecuted: vi.fn(),
      cancelTurn: vi.fn(),
      failTurn: vi.fn(),
      completeTurn: vi.fn(),
      deleteRun: vi.fn(),
      formatExecutionSummary: vi.fn(() => 'summary=ok'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      createId: (prefix) => `${prefix}_id`,
      buildRuntimeRepairPrompt: vi.fn(),
      now: () => new Date('2026-03-22T14:10:00.000Z'),
    })

    expect(result.runtimeGateRequired).toBe(false)
    expect(result.browserAutomationIntent).toBe(true)
    expect(result.maxExecutionAttempts).toBe(1)
    expect(result.contextLogLines).toEqual([
      '### Execution Context (2026-03-22T14:10:00.000Z)',
      '- Provider: (unknown) / (unknown)',
      '- Browser Automation Intent: yes',
      '- Runtime MCP Servers: filesystem',
      '- Settings MCP Servers: playwright',
      '- Sandbox Enabled: no',
      '- Warning: Browser automation intent detected, but no browser MCP server is present in the runtime config.',
    ])
  })
})
