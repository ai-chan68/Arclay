import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { AgentMessage } from '@shared-types'
import type { ApprovalListFilter, ApprovalRequestKind } from '../types/approval'
import type { PendingQuestion } from '../types/agent-new'
import type { TaskRuntimeRecord, TurnRecord, TurnTransitionResult } from '../types/turn-runtime'
import type { ExecutionCompletionSummary } from './execution-completion'
import type { Settings } from '../settings-store'
import { createTurnStateMessage, emitSseMessage } from './agent-stream-events'

const progressWriteQueues = new Map<string, Promise<void>>()
const EXECUTION_ARTIFACT_BASELINES: Record<string, string> = {
  'task_plan.md': `# Task Plan

## Recovery
- Runtime artifact guardrail recreated this file.
`,
  'findings.md': `# Findings & Decisions

## Recovery
- Runtime artifact guardrail recreated this file.
`,
  'progress.md': `# Progress Log

## Recovery
- Runtime artifact guardrail recreated this file before new evidence was appended.
`,
}

type ClarificationScope = Pick<ApprovalListFilter, 'taskId' | 'runId'>
type SseWritable = {
  write: (chunk: string) => unknown
}

export function buildAgentServiceUnavailableBody(): {
  error: string
  code: 'PROVIDER_ERROR'
} {
  return {
    error: '当前未初始化 Agent 服务，请先在设置中配置并启用 Provider。',
    code: 'PROVIDER_ERROR',
  }
}

export async function appendProgressEntry(progressPath: string, lines: string[]): Promise<void> {
  if (!progressPath || lines.length === 0) return
  const content = `\n\n${lines.join('\n')}\n`
  const previous = progressWriteQueues.get(progressPath) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await ensureExecutionArtifacts(progressPath)
        await appendFile(progressPath, content, 'utf-8')
      } catch (error) {
        console.warn('[agent-new] Failed to append progress log:', error)
      }
    })

  progressWriteQueues.set(progressPath, next)
  await next

  if (progressWriteQueues.get(progressPath) === next) {
    progressWriteQueues.delete(progressPath)
  }
}

async function ensureArtifactFile(filePath: string, content: string): Promise<void> {
  try {
    const existing = await readFile(filePath, 'utf-8')
    if (existing.trim().length > 0) {
      return
    }
  } catch {
    // Recreate below when missing or unreadable.
  }

  await writeFile(filePath, content, 'utf-8')
}

async function ensureExecutionArtifacts(progressPath: string): Promise<void> {
  const sessionDir = path.dirname(progressPath)
  await mkdir(sessionDir, { recursive: true })

  await Promise.all(
    Object.entries(EXECUTION_ARTIFACT_BASELINES).map(([filename, content]) =>
      ensureArtifactFile(path.join(sessionDir, filename), content)
    )
  )
}

export function createRouteMessageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

export function normalizeApprovalKind(kindRaw?: string): ApprovalRequestKind | undefined {
  if (kindRaw === 'permission' || kindRaw === 'question') {
    return kindRaw
  }
  return undefined
}

function getClarificationScope(taskId: string | undefined, runId: string): ClarificationScope {
  return taskId ? { taskId } : { runId }
}

export function createClarificationTracker(input: {
  taskId?: string
  runId: string
  list: (filter: ApprovalListFilter) => unknown[]
  listPending: (filter: Omit<ApprovalListFilter, 'status'>) => unknown[]
}): {
  getNextRound: () => number
  hasPending: () => boolean
} {
  const scopeFilter = getClarificationScope(input.taskId, input.runId)

  return {
    getNextRound: () => input.list({
      ...scopeFilter,
      kind: 'question',
      source: 'clarification',
    }).length + 1,
    hasPending: () => input.listPending({
      ...scopeFilter,
      kind: 'question',
      source: 'clarification',
    }).length > 0,
  }
}

export function buildTurnStateMessage(
  turn: TurnRecord,
  deps: {
    getRuntime: (taskId: string) => TaskRuntimeRecord | null
    createId: (prefix: string) => string
  }
): AgentMessage {
  const runtime = deps.getRuntime(turn.taskId)
  return createTurnStateMessage(turn, runtime?.version ?? 0, {
    createId: deps.createId,
  })
}

export function createTurnStateEmitter(input: {
  stream: SseWritable
  getRuntime: (taskId: string) => TaskRuntimeRecord | null
  createId: (prefix: string) => string
}): {
  (result: TurnTransitionResult | { turn: TurnRecord | null }): Promise<void>
  (
    writer: SseWritable,
    result: TurnTransitionResult | { turn: TurnRecord | null }
  ): Promise<void>
} {
  return async (
    firstArg: SseWritable | TurnTransitionResult | { turn: TurnRecord | null },
    secondArg?: TurnTransitionResult | { turn: TurnRecord | null }
  ) => {
    const result = secondArg ?? firstArg
    if (!result || typeof result !== 'object' || !('turn' in result)) return
    if (!result.turn) return
    await emitSseMessage(input.stream, buildTurnStateMessage(result.turn, {
      getRuntime: input.getRuntime,
      createId: input.createId,
    }))
  }
}

export function capturePendingInteraction(input: {
  message: AgentMessage
  context?: { taskId?: string; runId?: string; providerSessionId?: string }
  capturePermissionRequest: (
    permission: NonNullable<AgentMessage['permission']>,
    context?: { taskId?: string; runId?: string; providerSessionId?: string }
  ) => void
  captureQuestionRequest: (
    question: PendingQuestion,
    context?: {
      taskId?: string
      runId?: string
      providerSessionId?: string
      source?: 'clarification' | 'runtime_tool_question'
    }
  ) => void
}): void {
  const context = input.context || {}
  const message = input.message

  if (message.type === 'permission_request' && message.permission) {
    input.capturePermissionRequest(message.permission, {
      taskId: context.taskId,
      runId: context.runId,
      providerSessionId: context.providerSessionId,
    })
  }

  if (message.type === 'user' && message.question) {
    input.captureQuestionRequest(message.question, {
      taskId: context.taskId,
      runId: context.runId,
      providerSessionId: context.providerSessionId,
      source: 'runtime_tool_question',
    })
  }

  if (message.type === 'clarification_request' && message.clarification) {
    input.captureQuestionRequest(message.clarification, {
      taskId: context.taskId,
      runId: context.runId,
      providerSessionId: context.providerSessionId,
      source: 'runtime_tool_question',
    })
  }
}

export function formatExecutionCompletionSummary(summary: ExecutionCompletionSummary): string {
  const todo = summary.latestTodoSnapshot
    ? `${summary.latestTodoSnapshot.completed}/${summary.latestTodoSnapshot.total} completed, ${summary.latestTodoSnapshot.inProgress} in_progress, ${summary.latestTodoSnapshot.pending} pending, ${summary.latestTodoSnapshot.failed} failed`
    : 'none'
  return [
    `assistantText=${summary.assistantTextCount}`,
    `meaningfulAssistantText=${summary.meaningfulAssistantTextCount}`,
    `result=${summary.resultMessageCount}`,
    `toolUse=${summary.toolUseCount}`,
    `toolResult=${summary.toolResultCount}`,
    `meaningfulToolUse=${summary.meaningfulToolUseCount}`,
    `browserToolUse=${summary.browserToolUseCount}`,
    `browserNavigation=${summary.browserNavigationCount}`,
    `browserInteraction=${summary.browserInteractionCount}`,
    `browserSnapshot=${summary.browserSnapshotCount}`,
    `browserScreenshot=${summary.browserScreenshotCount}`,
    `browserEval=${summary.browserEvalCount}`,
    `todos=${todo}`,
    `pendingInteractions=${summary.pendingInteractionCount}`,
    `blockedArtifact=${summary.blockedArtifactPath || 'none'}`,
    `providerResult=${summary.providerResultSubtype || 'none'}`,
  ].join(', ')
}

export function detectPreflightClarification(
  prompt: string,
  createId: (prefix: string) => string
): PendingQuestion | null {
  const text = prompt.trim()
  if (!text) return null

  const lower = text.toLowerCase()
  const mentionsProjectScope = [
    '项目代码',
    '项目',
    '仓库',
    '代码库',
    '整个项目',
    '整个仓库',
    '全项目',
    'project',
    'repo',
    'repository',
    'codebase',
    'entire project',
    'whole repo',
  ].some((hint) => lower.includes(hint))

  const mentionsCodeOrFileTarget = [
    '代码',
    '文件',
    '目录',
    'source code',
    'files',
    'directory',
    'folder',
  ].some((hint) => lower.includes(hint))

  const mentionsCodebaseAction = [
    '读取',
    '分析',
    '扫描',
    '审查',
    '检查',
    '梳理',
    '总结',
    '优化',
    '重构',
    'review',
    'analyze',
    'scan',
    'inspect',
    'audit',
    'optimize',
    'refactor',
  ].some((hint) => lower.includes(hint))

  const hasExplicitTarget = (
    /(?:^|[\s"'`(])(?:\.{1,2}\/|~\/|\/|[a-zA-Z]:\\)[^\s"'`)]{1,}/.test(text) ||
    /\b(?:src|app|lib|packages|components|backend|frontend|server|client)\/[\w./-]+/i.test(text) ||
    /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|java|go|rs|c|cpp|h|hpp|sh|yaml|yml|toml)\b/i.test(text) ||
    /(当前工作区|当前仓库|this workspace|current workspace|this repo|current repo)/i.test(text)
  )

  if (!(mentionsProjectScope && mentionsCodeOrFileTarget && mentionsCodebaseAction) || hasExplicitTarget) {
    return null
  }

  return {
    id: createId('q'),
    question: '需要先确认目标项目路径。请提供要读取的项目目录（绝对路径或相对当前工作区路径）。',
    options: ['读取当前工作区（默认）', '我提供项目路径'],
    allowFreeText: true,
  }
}

export function addToolToAutoAllowList(toolName: string, deps: {
  getSettings: () => Settings | null
  setSettings: (settings: Settings) => void
  saveSettingsToFile: (settings: Settings) => void
  normalizeApprovalSettings: (approval?: Settings['approval']) => NonNullable<Settings['approval']>
}): { updated: boolean; tools: string[] } {
  const normalizedTool = toolName.trim()
  if (!normalizedTool) {
    const currentTools = deps.normalizeApprovalSettings(deps.getSettings()?.approval).autoAllowTools
    return { updated: false, tools: currentTools }
  }

  const currentSettings = deps.getSettings() || {
    activeProviderId: null,
    providers: [],
  } satisfies Settings
  const currentApproval = deps.normalizeApprovalSettings(currentSettings.approval)
  const currentTools = currentApproval.autoAllowTools
  if (currentTools.includes(normalizedTool)) {
    return { updated: false, tools: currentTools }
  }

  const nextApproval = deps.normalizeApprovalSettings({
    ...currentApproval,
    autoAllowTools: [...currentTools, normalizedTool],
  })
  const nextSettings: Settings = {
    ...currentSettings,
    approval: nextApproval,
  }
  deps.setSettings(nextSettings)
  deps.saveSettingsToFile(nextSettings)

  return {
    updated: true,
    tools: nextApproval.autoAllowTools,
  }
}
