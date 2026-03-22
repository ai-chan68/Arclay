import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { Settings } from '../../settings-store'
import type { TurnRecord } from '../../types/turn-runtime'
import type { ExecutionCompletionSummary } from '../execution-completion'
import {
  addToolToAutoAllowList,
  appendProgressEntry,
  buildAgentServiceUnavailableBody,
  buildTurnStateMessage,
  capturePendingInteraction,
  createClarificationTracker,
  createTurnStateEmitter,
  detectPreflightClarification,
  formatExecutionCompletionSummary,
  normalizeApprovalKind,
} from '../route-support'

describe('route-support', () => {
  it('captures permission and question style pending interactions with runtime_tool_question source', () => {
    const capturePermissionRequest = vi.fn()
    const captureQuestionRequest = vi.fn()

    capturePendingInteraction({
      message: {
        id: 'perm_msg',
        type: 'permission_request',
        role: 'assistant',
        content: 'Need permission',
        permission: {
          id: 'perm_1',
          toolName: 'Bash',
          command: 'pwd',
          reason: 'need cwd',
        },
        timestamp: 1,
      } as AgentMessage,
      context: {
        taskId: 'task_route_support',
        runId: 'run_route_support',
        providerSessionId: 'run_route_support',
      },
      capturePermissionRequest,
      captureQuestionRequest,
    })

    capturePendingInteraction({
      message: {
        id: 'question_msg',
        type: 'clarification_request',
        role: 'assistant',
        content: 'Need clarification',
        clarification: {
          id: 'q_1',
          question: '请选择输出格式',
          options: ['Markdown', 'JSON'],
          allowFreeText: true,
        },
        timestamp: 2,
      } as AgentMessage,
      context: {
        taskId: 'task_route_support',
        runId: 'run_route_support',
        providerSessionId: 'run_route_support',
      },
      capturePermissionRequest,
      captureQuestionRequest,
    })

    expect(capturePermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'perm_1' }),
      {
        taskId: 'task_route_support',
        runId: 'run_route_support',
        providerSessionId: 'run_route_support',
      }
    )
    expect(captureQuestionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q_1' }),
      {
        taskId: 'task_route_support',
        runId: 'run_route_support',
        providerSessionId: 'run_route_support',
        source: 'runtime_tool_question',
      }
    )
  })

  it('detects repo-wide code analysis prompts without explicit path targets', () => {
    const question = detectPreflightClarification(
      '请帮我读取整个项目代码和文件结构，分析整个仓库需要优化的地方',
      (prefix) => `${prefix}_id`
    )

    expect(question).toEqual({
      id: 'q_id',
      question: '需要先确认目标项目路径。请提供要读取的项目目录（绝对路径或相对当前工作区路径）。',
      options: ['读取当前工作区（默认）', '我提供项目路径'],
      allowFreeText: true,
    })

    expect(
      detectPreflightClarification(
        '请分析 src/components/Button.tsx 这个文件',
        (prefix) => `${prefix}_id`
      )
    ).toBeNull()
  })

  it('updates auto-allow tools only for new normalized tool names', () => {
    const existingSettings: Settings = {
      activeProviderId: null,
      providers: [],
      approval: {
        autoAllowTools: ['Read'],
        defaultMode: 'manual',
        persistDecisions: true,
      },
    }
    const setSettings = vi.fn()
    const saveSettingsToFile = vi.fn()
    const normalizeApprovalSettings = vi.fn((approval?: Settings['approval']) => ({
      defaultMode: approval?.defaultMode || 'manual',
      persistDecisions: approval?.persistDecisions ?? true,
      autoAllowTools: approval?.autoAllowTools || [],
    }))

    const updated = addToolToAutoAllowList('  Bash  ', {
      getSettings: () => existingSettings,
      setSettings,
      saveSettingsToFile,
      normalizeApprovalSettings,
    })

    expect(updated).toEqual({
      updated: true,
      tools: ['Read', 'Bash'],
    })
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
      approval: expect.objectContaining({
        autoAllowTools: ['Read', 'Bash'],
      }),
    }))
    expect(saveSettingsToFile).toHaveBeenCalledTimes(1)

    const unchanged = addToolToAutoAllowList('Read', {
      getSettings: () => existingSettings,
      setSettings: vi.fn(),
      saveSettingsToFile: vi.fn(),
      normalizeApprovalSettings,
    })
    expect(unchanged).toEqual({
      updated: false,
      tools: ['Read'],
    })
  })

  it('formats execution completion summary consistently', () => {
    const summary: ExecutionCompletionSummary = {
      toolUseCount: 3,
      toolResultCount: 2,
      meaningfulToolUseCount: 1,
      browserToolUseCount: 1,
      browserNavigationCount: 1,
      browserInteractionCount: 0,
      browserSnapshotCount: 0,
      browserScreenshotCount: 0,
      browserEvalCount: 0,
      assistantTextCount: 2,
      meaningfulAssistantTextCount: 1,
      preambleAssistantTextCount: 0,
      resultMessageCount: 1,
      latestTodoSnapshot: {
        total: 2,
        completed: 1,
        inProgress: 1,
        pending: 0,
        failed: 0,
        currentItems: ['doing work'],
      },
      pendingInteractionCount: 1,
      blockerCandidate: null,
      blockedArtifactPath: '/tmp/task_blocked_summary.md',
      providerResultSubtype: 'max_turns',
      providerStopReason: null,
    }

    expect(formatExecutionCompletionSummary(summary)).toBe(
      'assistantText=2, meaningfulAssistantText=1, result=1, toolUse=3, toolResult=2, meaningfulToolUse=1, browserToolUse=1, browserNavigation=1, browserInteraction=0, browserSnapshot=0, browserScreenshot=0, browserEval=0, todos=1/2 completed, 1 in_progress, 0 pending, 0 failed, pendingInteractions=1, blockedArtifact=/tmp/task_blocked_summary.md, providerResult=max_turns'
    )
  })

  it('normalizes approval kinds and builds service unavailable payload', () => {
    expect(normalizeApprovalKind('permission')).toBe('permission')
    expect(normalizeApprovalKind('question')).toBe('question')
    expect(normalizeApprovalKind('other')).toBeUndefined()
    expect(buildAgentServiceUnavailableBody()).toEqual({
      error: '当前未初始化 Agent 服务，请先在设置中配置并启用 Provider。',
      code: 'PROVIDER_ERROR',
    })
  })

  it('tracks clarification rounds by task when present and falls back to run scope', () => {
    const list = vi.fn(() => [{ id: 'q_1' }, { id: 'q_2' }])
    const listPending = vi.fn(() => [{ id: 'q_pending' }])

    const taskScoped = createClarificationTracker({
      taskId: 'task_1',
      runId: 'run_1',
      list,
      listPending,
    })

    expect(taskScoped.getNextRound()).toBe(3)
    expect(taskScoped.hasPending()).toBe(true)
    expect(list).toHaveBeenCalledWith({
      taskId: 'task_1',
      kind: 'question',
      source: 'clarification',
    })
    expect(listPending).toHaveBeenCalledWith({
      taskId: 'task_1',
      kind: 'question',
      source: 'clarification',
    })

    list.mockClear()
    listPending.mockClear()
    const runScoped = createClarificationTracker({
      runId: 'run_2',
      list,
      listPending,
    })

    runScoped.getNextRound()
    runScoped.hasPending()
    expect(list).toHaveBeenCalledWith({
      runId: 'run_2',
      kind: 'question',
      source: 'clarification',
    })
    expect(listPending).toHaveBeenCalledWith({
      runId: 'run_2',
      kind: 'question',
      source: 'clarification',
    })
  })

  it('builds and emits turn state messages with runtime version', async () => {
    const turn: TurnRecord = {
      id: 'turn_1',
      taskId: 'task_1',
      runId: 'run_1',
      prompt: 'do work',
      state: 'executing',
      readVersion: 2,
      writeVersion: null,
      blockedByTurnIds: [],
      reason: null,
      createdAt: 100,
      updatedAt: 200,
    }

    const message = buildTurnStateMessage(turn, {
      getRuntime: () => ({
        taskId: 'task_1',
        version: 7,
        status: 'running',
        activeTurnId: 'turn_1',
        updatedAt: 300,
      }),
      createId: (prefix) => `${prefix}_id`,
    })

    expect(message).toEqual(expect.objectContaining({
      id: 'msg_id',
      type: 'turn_state',
      turn: expect.objectContaining({
        turnId: 'turn_1',
        taskId: 'task_1',
        taskVersion: 7,
        state: 'executing',
      }),
    }))

    const writes: string[] = []
    const emitTurnState = createTurnStateEmitter({
      stream: {
        write: (chunk) => {
          writes.push(chunk)
        },
      },
      getRuntime: () => ({
        taskId: 'task_1',
        version: 7,
        status: 'running',
        activeTurnId: 'turn_1',
        updatedAt: 300,
      }),
      createId: (prefix) => `${prefix}_emit`,
    })

    await emitTurnState({ turn })

    expect(writes.join('')).toContain('event: turn_state')
    expect(writes.join('')).toContain('"type":"turn_state"')
    expect(writes.join('')).toContain('"taskVersion":7')
  })

  it('serializes progress appends per file path', async () => {
    const progressPath = `/tmp/route-support-progress-${Date.now()}.log`

    await Promise.all([
      appendProgressEntry(progressPath, ['first']),
      appendProgressEntry(progressPath, ['second']),
    ])

    const { readFile, unlink } = await import('fs/promises')
    const content = await readFile(progressPath, 'utf-8')
    expect(content).toContain('first')
    expect(content).toContain('second')

    await unlink(progressPath)
  })

  it('recreates missing execution artifact files before appending progress evidence', async () => {
    const { mkdtemp, readFile, rm } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')

    const sessionDir = await mkdtemp(join(tmpdir(), 'route-support-artifacts-'))
    const progressPath = join(sessionDir, 'progress.md')

    await rm(sessionDir, { recursive: true, force: true })

    await appendProgressEntry(progressPath, ['evidence-line'])

    const progressContent = await readFile(progressPath, 'utf-8')
    const taskPlanContent = await readFile(join(sessionDir, 'task_plan.md'), 'utf-8')
    const findingsContent = await readFile(join(sessionDir, 'findings.md'), 'utf-8')

    expect(progressContent).toContain('evidence-line')
    expect(taskPlanContent).toContain('# Task Plan')
    expect(findingsContent).toContain('# Findings & Decisions')

    await rm(sessionDir, { recursive: true, force: true })
  })
})
