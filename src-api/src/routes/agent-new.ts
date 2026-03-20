/**
 * Agent API routes - New two-phase execution architecture
 *
 * easywork-style two-phase execution:
 *   Phase 1: POST /agent/plan - Generate plan
 *   Phase 2: POST /agent/execute - Execute approved plan
 *   Direct: POST /agent - Direct execution (compatibility mode)
 *
 * 会话和消息的持久化由前端数据库层 (SQLite/IndexedDB) 负责，
 * 后端仅负责执行和流式返回。
 */

import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { appendFile } from 'fs/promises'
import path from 'path'
import type { TaskPlan, PermissionRequest, PendingQuestion } from '../types/agent-new'
import type { AgentMessage, MessageAttachment } from '@shared-types'
import type { ConversationMessage } from '../core/agent/interface'
import { AgentService, type AgentServiceConfig } from '../services/agent-service'
import { buildExecutionPrompt } from '../services/plan-execution'
import { bootstrapPlanningFiles } from '../services/planning-files'
import { approvalCoordinator } from '../services/approval-coordinator'
import { planStore } from '../services/plan-store'
import { cancelTurnsForExpiredPlans } from '../services/plan-turn-sync'
import { turnRuntimeStore } from '../services/turn-runtime-store'
import {
  getSettings,
  normalizeApprovalSettings,
  saveSettingsToFile,
  setSettings,
  type Settings,
} from '../settings-store'
import type { TurnRecord, TurnTransitionResult } from '../types/turn-runtime'

// Global run and plan storage
interface AgentRun {
  id: string
  createdAt: Date
  phase: 'plan' | 'execute'
  isAborted: boolean
  abortController: AbortController
}

interface TodoProgressSnapshot {
  total: number
  completed: number
  inProgress: number
  pending: number
  failed: number
  currentItems: string[]
}

interface ExecutionObservation {
  commands: string[]
  discoveredUrls: Set<string>
  passedHealthUrls: Set<string>
  portHints: Set<number>
  frontendCommandCount: number
  backendCommandCount: number
  portConflicts: string[]
}

interface RuntimeGateResult {
  passed: boolean
  reason: string
  checkedUrls: string[]
  healthyUrls: string[]
  previewUrl: string | null
  frontendExpected: boolean
  frontendHealthy: boolean
  backendExpected: boolean
  backendHealthy: boolean
}

interface ExecutionCompletionSummary {
  toolUseCount: number
  toolResultCount: number
  meaningfulToolUseCount: number
  browserToolUseCount: number
  assistantTextCount: number
  meaningfulAssistantTextCount: number
  preambleAssistantTextCount: number
  resultMessageCount: number
  latestTodoSnapshot: TodoProgressSnapshot | null
  pendingInteractionCount: number
  blockerCandidate: ExecutionBlockerCandidate | null
  blockedArtifactPath: string | null
}

interface ExecutionBlockerCandidate {
  reason: string
  userMessage: string
}

const activeRuns = new Map<string, AgentRun>()
const progressWriteQueues = new Map<string, Promise<void>>()
const DEFAULT_MAX_CLARIFICATION_ROUNDS = 3
const MAX_CLARIFICATION_ROUNDS_LIMIT = 10
const MAX_RUNTIME_REPAIR_ATTEMPTS = 1
const EASYWORK_INTERNAL_PORTS = new Set([1420, 2026, 2027])

let agentService: AgentService | null = null
let agentServiceConfig: AgentServiceConfig | null = null

export function setAgentService(service: AgentService, config: AgentServiceConfig): void {
  agentService = service
  agentServiceConfig = config
}

export function clearAgentService(): void {
  agentService = null
  agentServiceConfig = null
}

export function getAgentService(): AgentService | null {
  return agentService
}

function getAgentServiceUnavailableResponse(c: Context) {
  return c.json({
    error: '当前未初始化 Agent 服务，请先在设置中配置并启用 Provider。',
    code: 'PROVIDER_ERROR',
  }, 500)
}

function capturePendingInteraction(
  message: AgentMessage,
  context: { taskId?: string; runId?: string; providerSessionId?: string } = {}
): void {
  if (message.type === 'permission_request' && message.permission) {
    approvalCoordinator.capturePermissionRequest(message.permission, {
      taskId: context.taskId,
      runId: context.runId,
      providerSessionId: context.providerSessionId,
    })
  }

  if (message.type === 'user' && message.question) {
    approvalCoordinator.captureQuestionRequest(message.question, {
      taskId: context.taskId,
      runId: context.runId,
      providerSessionId: context.providerSessionId,
      source: 'runtime_tool_question',
    })
  }

  if (message.type === 'clarification_request' && message.clarification) {
    approvalCoordinator.captureQuestionRequest(message.clarification, {
      taskId: context.taskId,
      runId: context.runId,
      providerSessionId: context.providerSessionId,
      source: 'runtime_tool_question',
    })
  }
}

function extractTodoProgressSnapshot(message: AgentMessage): TodoProgressSnapshot | null {
  if (message.type !== 'tool_use' || message.toolName !== 'TodoWrite' || !message.toolInput) {
    return null
  }

  const todosRaw = (message.toolInput as Record<string, unknown>).todos
  if (!Array.isArray(todosRaw) || todosRaw.length === 0) {
    return null
  }

  const normalized = todosRaw
    .map((todo) => {
      if (!todo || typeof todo !== 'object') return null
      const record = todo as Record<string, unknown>
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      const status = typeof record.status === 'string' ? record.status.trim() : ''
      if (!status) return null
      return {
        content,
        status,
      }
    })
    .filter((todo): todo is { content: string; status: string } => !!todo)

  if (normalized.length === 0) {
    return null
  }

  let completed = 0
  let inProgress = 0
  let pending = 0
  let failed = 0
  const currentItems: string[] = []

  for (const todo of normalized) {
    if (todo.status === 'completed') {
      completed += 1
      continue
    }
    if (todo.status === 'in_progress') {
      inProgress += 1
      if (todo.content) {
        currentItems.push(todo.content)
      }
      continue
    }
    if (todo.status === 'failed') {
      failed += 1
      continue
    }
    pending += 1
  }

  return {
    total: normalized.length,
    completed,
    inProgress,
    pending,
    failed,
    currentItems,
  }
}

async function appendProgressEntry(progressPath: string, lines: string[]): Promise<void> {
  if (!progressPath || lines.length === 0) return
  const content = `\n\n${lines.join('\n')}\n`
  const previous = progressWriteQueues.get(progressPath) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
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

function summarizeToolInput(input?: Record<string, unknown>): string {
  if (!input) return ''
  const parts: string[] = []

  for (const [key, value] of Object.entries(input).slice(0, 4)) {
    let rendered = ''
    if (typeof value === 'string') {
      rendered = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      rendered = String(value)
    } else {
      rendered = JSON.stringify(value)
    }
    if (rendered.length > 120) {
      rendered = `${rendered.slice(0, 117)}...`
    }
    parts.push(`${key}=${rendered}`)
  }

  return parts.join(', ')
}

function summarizeTextForAudit(text?: string): string {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized
}

async function appendExecutionAudit(progressPath: string, label: string, detail: string): Promise<void> {
  const normalizedDetail = summarizeTextForAudit(detail)
  await appendProgressEntry(progressPath, [
    `### Tool Trace (${new Date().toISOString()})`,
    normalizedDetail ? `- ${label}: ${normalizedDetail}` : `- ${label}`,
  ])
}

function formatExecutionCompletionSummary(summary: ExecutionCompletionSummary): string {
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
    `todos=${todo}`,
    `pendingInteractions=${summary.pendingInteractionCount}`,
    `blockedArtifact=${summary.blockedArtifactPath || 'none'}`,
  ].join(', ')
}

function normalizeInteractiveBlockerText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function looksLikeInteractiveBlocker(text: string): boolean {
  const normalized = normalizeInteractiveBlockerText(text)
  if (!normalized) return false

  const blockerPatterns = [
    /等待用户/i,
    /需要用户/i,
    /需要你/i,
    /请你/i,
    /请先/i,
    /回复我继续/i,
    /provide.*login/i,
    /need.*login/i,
    /waiting for user/i,
    /user input/i,
    /manual/i,
    /登录/,
    /认证/,
    /验证码/,
    /verify/,
    /approve/,
    /approval/,
    /confirm/,
    /captcha/i,
  ]

  return blockerPatterns.some((pattern) => pattern.test(normalized))
}

function detectBrowserToolBlockerText(text: string): ExecutionBlockerCandidate | null {
  const normalized = normalizeInteractiveBlockerText(text)
  if (!normalized) return null

  const loginLike = /login\.netease\.com|登录|登录并授权|authorize|approval|认证|验证码|captcha/i.test(normalized)
  if (!loginLike) {
    return null
  }

  const userMessage = /登录并授权/.test(normalized)
    ? '当前页面仍停留在登录授权流程，请确认点击并完成“登录并授权”后回复我继续。'
    : '当前页面仍停留在登录/认证流程，请先完成登录后回复我继续。'

  return {
    reason: normalized,
    userMessage,
  }
}

function buildExecutionBlockerCandidate(
  message: AgentMessage,
  options?: { trustAssistantText?: boolean; browserAutomationIntent?: boolean },
): ExecutionBlockerCandidate | null {
  const trustAssistantText = options?.trustAssistantText !== false

  if (message.type === 'text' && message.role === 'assistant' && message.content?.trim()) {
    if (!trustAssistantText) {
      return null
    }
    const normalized = normalizeInteractiveBlockerText(message.content)
    if (!looksLikeInteractiveBlocker(normalized)) {
      return null
    }
    return {
      reason: normalized,
      userMessage: normalized,
    }
  }

  if (message.type !== 'tool_use' || message.toolName !== 'TodoWrite' || !message.toolInput) {
    return null
  }

  const todosRaw = (message.toolInput as Record<string, unknown>).todos
  if (!Array.isArray(todosRaw)) {
    return null
  }

  for (const todo of todosRaw) {
    if (!todo || typeof todo !== 'object') continue
    const record = todo as Record<string, unknown>
    const status = typeof record.status === 'string' ? record.status.trim() : ''
    if (status !== 'in_progress') continue
    const content = typeof record.activeForm === 'string' && record.activeForm.trim()
      ? record.activeForm.trim()
      : (typeof record.content === 'string' ? record.content.trim() : '')
    if (!content || !looksLikeInteractiveBlocker(content)) continue
    return {
      reason: content,
      userMessage: `执行被阻塞：${content}。请处理后回复我继续。`,
    }
  }

  return null
}

function detectBlockedArtifactPath(message: AgentMessage): string | null {
  if (message.type !== 'tool_use' || !message.toolInput) {
    return null
  }

  if (message.toolName !== 'Write' && message.toolName !== 'Edit' && message.toolName !== 'MultiEdit') {
    return null
  }

  const input = message.toolInput as Record<string, unknown>
  const filePath = typeof input.file_path === 'string'
    ? input.file_path.trim()
    : (typeof input.filePath === 'string' ? input.filePath.trim() : '')

  if (!filePath) {
    return null
  }

  const normalized = path.basename(filePath)
  return normalized === 'task_blocked_summary.md' ? filePath : null
}

function buildBlockedTurnUserMessage(blockedByTurnIds?: string[]): string {
  if (Array.isArray(blockedByTurnIds) && blockedByTurnIds.length > 0) {
    return `当前回合正在等待前序回合完成。依赖回合：${blockedByTurnIds.join(', ')}。请稍后重试。`
  }

  return '当前回合正在等待前序回合完成，请稍后重试。'
}

function buildExecutionBlockedQuestion(candidate: ExecutionBlockerCandidate): PendingQuestion {
  return {
    id: generateId('question'),
    question: candidate.userMessage,
    options: ['已处理，请继续', '需要我补充信息'],
    allowFreeText: true,
    source: 'runtime_tool_question',
  }
}

function requiresUserVisibleResult(promptText: string, plan: TaskPlan): boolean {
  const corpus = [promptText, plan.goal, ...plan.steps.map((step) => step.description)]
    .join('\n')
    .toLowerCase()

  const resultIntentPatterns = [
    /获取/,
    /提取/,
    /查询/,
    /返回/,
    /输出/,
    /总结/,
    /订单号/,
    /\bget\b/,
    /\bextract\b/,
    /\bretrieve\b/,
    /\breturn\b/,
    /\bprovide\b/,
    /\bsummarize\b/,
    /\bsummary\b/,
    /\bresult\b/,
    /\border number\b/,
  ]

  return resultIntentPatterns.some((pattern) => pattern.test(corpus))
}

function isExecutionPreambleText(content?: string | null): boolean {
  const normalized = content?.replace(/\s+/g, ' ').trim()
  if (!normalized) return false

  return [
    /^i['’]?ll start by\b/i,
    /^let me\b/i,
    /^i need to use\b/i,
    /^i see\b.*\boperating as\b/i,
    /^现在开始/i,
    /^现在(?:点击|输入|查看|打开|获取|提取|执行)/,
    /^页面已(?:导航|加载|跳转)/,
  ].some((pattern) => pattern.test(normalized))
}

function isPreparatoryToolUse(toolName?: string | null): boolean {
  const normalized = (toolName || '').trim()
  if (!normalized) return false

  return [
    'TodoWrite',
    'Read',
    'Glob',
    'Grep',
    'LS',
    'LSP',
  ].includes(normalized)
}

function isBrowserAutomationToolUse(toolName?: string | null): boolean {
  const normalized = (toolName || '').trim()
  if (!normalized) return false

  return /^mcp__chrome-devtools__/i.test(normalized) || /playwright/i.test(normalized)
}

function detectIncompleteExecution(
  summary: ExecutionCompletionSummary,
  promptText: string,
  plan: TaskPlan
): string | null {
  if (summary.blockedArtifactPath) {
    return `Execution stopped after producing blocked summary: ${summary.blockedArtifactPath}`
  }

  if (summary.pendingInteractionCount > 0) {
    return 'Execution ended while approval or clarification was still pending.'
  }

  if (summary.latestTodoSnapshot) {
    const { completed, total, inProgress, pending, failed } = summary.latestTodoSnapshot
    if (completed < total || inProgress > 0 || pending > 0 || failed > 0) {
      return 'Execution ended before completing all planned steps.'
    }
  }

  const browserAutomationIntent = isBrowserAutomationIntent(promptText, plan)
  const needsUserVisibleResult = requiresUserVisibleResult(promptText, plan)

  if (browserAutomationIntent && summary.browserToolUseCount === 0 && summary.resultMessageCount === 0) {
    return 'Execution ended before starting any browser automation steps.'
  }

  if (
    summary.toolUseCount === 0 &&
    summary.resultMessageCount === 0 &&
    summary.preambleAssistantTextCount > 0 &&
    needsUserVisibleResult
  ) {
    return 'Execution ended before starting any planned step output.'
  }

  if (
    summary.meaningfulToolUseCount === 0 &&
    summary.meaningfulAssistantTextCount === 0 &&
    summary.resultMessageCount === 0 &&
    needsUserVisibleResult
  ) {
    return 'Execution ended without performing any meaningful execution steps.'
  }

  if (
    summary.toolUseCount > 0 &&
    summary.meaningfulToolUseCount > 0 &&
    summary.assistantTextCount === 0 &&
    summary.resultMessageCount === 0 &&
    needsUserVisibleResult
  ) {
    return 'Execution ended without producing a final user-visible result.'
  }

  return null
}

function createExecutionObservation(): ExecutionObservation {
  return {
    commands: [],
    discoveredUrls: new Set<string>(),
    passedHealthUrls: new Set<string>(),
    portHints: new Set<number>(),
    frontendCommandCount: 0,
    backendCommandCount: 0,
    portConflicts: [],
  }
}

function normalizeLoopbackUrl(rawUrl: string): string {
  return rawUrl
    .replace('://0.0.0.0', '://127.0.0.1')
    .replace(/[),.;\]}>]+$/, '')
}

function extractLoopbackUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/[^\s"')\]}]*)?/gi) || []
  return Array.from(new Set(matches.map(normalizeLoopbackUrl)))
}

function isFrontendStartCommand(command: string): boolean {
  const lower = command.toLowerCase()
  return (
    /\b(vite|next dev|nuxt dev|webpack serve)\b/.test(lower) ||
    /\b(npm|pnpm|yarn)\s+run\s+dev\b/.test(lower)
  )
}

function isBackendStartCommand(command: string): boolean {
  const lower = command.toLowerCase()
  return (
    /\b(flask run|uvicorn|gunicorn|python .*app\.py|node .*server)\b/.test(lower) ||
    /\b(npm|pnpm|yarn)\s+run\s+start(?::api)?\b/.test(lower)
  )
}

function collectPortHints(text: string, target: Set<number>): void {
  const hostPortRegex = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi
  const longFlagRegex = /--port\s+(\d{2,5})/gi
  const envRegex = /\bPORT=(\d{2,5})\b/g
  const fixedDefaults = [5001, 5173]

  for (const regex of [hostPortRegex, longFlagRegex, envRegex]) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const parsed = Number.parseInt(match[1], 10)
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
        target.add(parsed)
      }
    }
  }

  for (const port of fixedDefaults) {
    if (text.includes(String(port))) {
      target.add(port)
    }
  }
}

function parseToolOutputText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
              return (item as { text: string }).text
            }
            return JSON.stringify(item)
          })
          .join('\n')
      }
      if (parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
        return String((parsed as { text: string }).text)
      }
    } catch {
      // keep raw output
    }
  }

  return raw
}

function collectExecutionObservation(message: AgentMessage, observation: ExecutionObservation): void {
  if (message.type === 'tool_use') {
    const command = typeof message.toolInput?.command === 'string'
      ? message.toolInput.command
      : ''
    const args = Array.isArray(message.toolInput?.args)
      ? message.toolInput?.args.filter((item): item is string => typeof item === 'string').join(' ')
      : ''
    const fullCommand = `${command}${args ? ` ${args}` : ''}`.trim()

    if (fullCommand) {
      observation.commands.push(fullCommand)
      for (const url of extractLoopbackUrls(fullCommand)) {
        observation.discoveredUrls.add(url)
      }
      collectPortHints(fullCommand, observation.portHints)
      if (isFrontendStartCommand(fullCommand)) observation.frontendCommandCount += 1
      if (isBackendStartCommand(fullCommand)) observation.backendCommandCount += 1
    }
    return
  }

  if (message.type !== 'tool_result' || typeof message.toolOutput !== 'string') {
    return
  }

  const text = parseToolOutputText(message.toolOutput)
  if (!text) return

  for (const url of extractLoopbackUrls(text)) {
    observation.discoveredUrls.add(url)
  }
  collectPortHints(text, observation.portHints)

  const healthPassMatches = text.matchAll(/Health check:\s*passed(?:\s*\((https?:\/\/[^)\s]+)\))?/gi)
  for (const match of healthPassMatches) {
    const candidate = typeof match[1] === 'string' ? match[1] : ''
    if (candidate) {
      observation.passedHealthUrls.add(normalizeLoopbackUrl(candidate))
    }
  }

  if (/port\s+\d+\s+is already in use/i.test(text) || /address already in use/i.test(text)) {
    observation.portConflicts.push(text)
  }
}

function isRuntimeRunIntent(promptText: string, plan: TaskPlan): boolean {
  const corpus = [promptText, plan.goal, ...plan.steps.map((step) => step.description)].join('\n').toLowerCase()
  const browserAutomationHint = /chrome-devtools|playwright|浏览器|radio button|单选框|点击|填入|输入|查询/.test(corpus)
  const externalOrInternalUrlHint = /https?:\/\/\S+|yx\.mail\.netease\.com/.test(corpus)
  if (browserAutomationHint && externalOrInternalUrlHint) {
    return false
  }
  const runHint = /运行|启动|run|start|dev server|preview|可跑起来|本地启动|serve/.test(corpus)
  const targetHint = /项目|project|repo|repository|frontend|backend|server|service|web|app|页面|界面|api/.test(corpus)
  return runHint && targetHint
}

function isBrowserAutomationIntent(promptText: string, plan: TaskPlan): boolean {
  const corpus = [promptText, plan.goal, ...plan.steps.map((step) => step.description)].join('\n').toLowerCase()
  const browserAutomationHint = /chrome-devtools|playwright|浏览器|radio button|单选框|点击|填入|输入|查询/.test(corpus)
  const externalOrInternalUrlHint = /https?:\/\/\S+|yx\.mail\.netease\.com/.test(corpus)
  return browserAutomationHint && externalOrInternalUrlHint
}

function collectConfiguredServerNames(record?: Record<string, unknown> | null): string[] {
  if (!record) return []
  return Object.keys(record).filter((name) => name.trim().length > 0)
}

function hasBrowserAutomationServer(serverNames: string[]): boolean {
  return serverNames.some((name) => /chrome-devtools|playwright|browser|devtools/i.test(name))
}

function buildExecutionContextLogLines(promptText: string, plan: TaskPlan): string[] {
  const settings = getSettings()
  const settingsMcpServers = collectConfiguredServerNames(settings?.mcp?.mcpServers as Record<string, unknown> | undefined)
  const runtimeMcpServers = collectConfiguredServerNames(agentServiceConfig?.mcp?.mcpServers as Record<string, unknown> | undefined)
  const browserAutomationIntent = isBrowserAutomationIntent(promptText, plan)
  const providerName = agentServiceConfig?.provider?.provider || '(unknown)'
  const providerModel = agentServiceConfig?.provider?.model || '(unknown)'
  const sandboxEnabled = agentServiceConfig?.sandbox?.enabled === true
  const browserAutomationRuntimeReady = hasBrowserAutomationServer(runtimeMcpServers)

  const lines = [
    `### Execution Context (${new Date().toISOString()})`,
    `- Provider: ${providerName} / ${providerModel}`,
    `- Browser Automation Intent: ${browserAutomationIntent ? 'yes' : 'no'}`,
    `- Runtime MCP Servers: ${runtimeMcpServers.length > 0 ? runtimeMcpServers.join(', ') : '(none)'}`,
    `- Settings MCP Servers: ${settingsMcpServers.length > 0 ? settingsMcpServers.join(', ') : '(none)'}`,
    `- Sandbox Enabled: ${sandboxEnabled ? 'yes' : 'no'}`,
  ]

  if (browserAutomationIntent && !browserAutomationRuntimeReady) {
    lines.push('- Warning: Browser automation intent detected, but no browser MCP server is present in the runtime config.')
  }

  return lines
}

function buildUrlCandidates(observation: ExecutionObservation): string[] {
  const candidates = new Set<string>()

  for (const url of observation.discoveredUrls) {
    candidates.add(url)
  }

  for (const url of observation.passedHealthUrls) {
    candidates.add(url)
  }

  for (const port of observation.portHints) {
    candidates.add(`http://127.0.0.1:${port}`)
    candidates.add(`http://127.0.0.1:${port}/api/health`)
  }

  if (observation.frontendCommandCount > 0 && observation.portHints.size === 0) {
    candidates.add('http://127.0.0.1:5173')
    candidates.add('http://127.0.0.1:5174')
  }

  if (observation.backendCommandCount > 0 && observation.portHints.size === 0) {
    candidates.add('http://127.0.0.1:5001/api/health')
  }

  return [...candidates]
}

function isSessionWorkspaceWorkDir(workDir: string): boolean {
  const normalized = workDir.replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/workspace/sessions/')
}

function shouldExcludeRuntimeUrl(url: string, workDir: string): boolean {
  if (!isSessionWorkspaceWorkDir(workDir)) return false
  try {
    const parsed = new URL(url)
    const port = Number.parseInt(parsed.port, 10)
    if (!Number.isFinite(port)) return false
    return EASYWORK_INTERNAL_PORTS.has(port)
  } catch {
    return false
  }
}

async function probeUrlHealth(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutHandle)
  }
}

async function evaluateRuntimeGate(observation: ExecutionObservation, workDir: string): Promise<RuntimeGateResult> {
  const candidates = buildUrlCandidates(observation)
    .filter((url) => !shouldExcludeRuntimeUrl(url, workDir))
  const healthy: string[] = []

  for (const url of candidates) {
    if (await probeUrlHealth(url)) {
      healthy.push(url)
    }
  }

  const frontendExpected = observation.frontendCommandCount > 0
  const backendExpected = observation.backendCommandCount > 0
  const frontendHealthy = healthy.some((url) => {
    try {
      const parsed = new URL(url)
      return !parsed.pathname.startsWith('/api')
    } catch {
      return false
    }
  })
  const backendHealthy = healthy.some((url) => {
    try {
      const parsed = new URL(url)
      return parsed.pathname.startsWith('/api') || parsed.pathname.startsWith('/health')
    } catch {
      return false
    }
  })

  const hasAnyHealthy = healthy.length > 0
  let passed = true
  let reason = 'Runtime verification passed.'

  if (frontendExpected && !frontendHealthy) {
    passed = false
    reason = 'Frontend server did not pass health check after execution.'
  } else if (backendExpected && !backendHealthy) {
    passed = false
    reason = 'Backend server did not pass health check after execution.'
  } else if (!frontendExpected && !backendExpected && !hasAnyHealthy) {
    passed = false
    reason = 'No healthy local endpoint detected after run execution.'
  } else if (observation.portConflicts.length > 0 && !hasAnyHealthy) {
    passed = false
    reason = 'Port conflict detected and no healthy endpoint recovered.'
  }

  const previewUrl = frontendHealthy
    ? healthy.find((url) => {
        try {
          return !new URL(url).pathname.startsWith('/api')
        } catch {
          return false
        }
      }) || null
    : null

  return {
    passed,
    reason,
    checkedUrls: candidates,
    healthyUrls: healthy,
    previewUrl,
    frontendExpected,
    frontendHealthy,
    backendExpected,
    backendHealthy,
  }
}

function buildRuntimeRepairPrompt(
  executionPrompt: string,
  gate: RuntimeGateResult,
  workDir: string
): string {
  const checked = gate.checkedUrls.length > 0 ? gate.checkedUrls.join(', ') : '(none)'
  const healthy = gate.healthyUrls.length > 0 ? gate.healthyUrls.join(', ') : '(none)'

  return `${executionPrompt}

## Automatic Runtime Repair Required

Previous execution did not satisfy runtime verification.
- Reason: ${gate.reason}
- Checked URLs: ${checked}
- Healthy URLs: ${healthy}
- Work dir: ${workDir}

You MUST self-repair now:
1. Detect and resolve port conflicts without killing unrelated processes.
2. Start required services in background using sandbox_run_command.
3. Run explicit health checks for backend and frontend endpoints.
4. Report the final reachable frontend preview URL and backend health URL.
5. Do not finish until verification endpoints return HTTP 200.`
}

/**
 * Create a new agent runtime run
 */
function createRun(phase: 'plan' | 'execute'): AgentRun {
  const id = `run_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  const run: AgentRun = {
    id,
    createdAt: new Date(),
    phase,
    isAborted: false,
    abortController: new AbortController(),
  }
  activeRuns.set(id, run)
  return run
}

/**
 * Delete a runtime run
 */
function deleteRun(runId: string): void {
  const run = activeRuns.get(runId)
  if (run) {
    run.abortController.abort()
    activeRuns.delete(runId)
  }
}

/**
 * Generate a unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

function isLikelyPlanningPlaceholderText(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  if (text.length > 180) return false

  const lower = text.toLowerCase()
  const intentHints = [
    '我将', '我会', '我先', '我正在', '接下来', '让我',
    'i will', "i'll", 'let me', "i'm going to", 'i am going to',
  ]
  const actionHints = [
    '搜索', '查找', '分析', '整理', '汇总', '查询',
    'search', 'look up', 'analyze', 'summarize', 'collect',
  ]
  const conclusionHints = [
    '结论', '总结', '综上', '因此',
    'in summary', 'overall', 'therefore',
  ]

  const hasIntent = intentHints.some((hint) => text.includes(hint) || lower.includes(hint))
  const hasAction = actionHints.some((hint) => text.includes(hint) || lower.includes(hint))
  const hasConclusion = conclusionHints.some((hint) => text.includes(hint) || lower.includes(hint))

  return hasIntent && hasAction && !hasConclusion
}

function createFallbackPlanningPlan(prompt: string, rawText?: string): TaskPlan {
  const trimmed = (rawText || '').trim()
  const summary = trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed
  const notes = [
    '规划阶段返回了说明性文本，已自动生成兜底计划以继续审批流程。',
    summary ? `原始文本摘要：${summary}` : '',
  ].filter(Boolean).join(' ')

  return {
    id: generateId('plan'),
    goal: prompt,
    steps: [
      { id: 'step_0', description: '收集完成任务所需的信息和上下文', status: 'pending' },
      { id: 'step_1', description: '执行核心步骤并产出中间结果', status: 'pending' },
      { id: 'step_2', description: '校验结果并整理最终输出', status: 'pending' },
    ],
    notes,
    createdAt: new Date(),
  }
}

function normalizeApprovalKind(kindRaw?: string): 'permission' | 'question' | undefined {
  if (kindRaw === 'permission' || kindRaw === 'question') {
    return kindRaw
  }
  return undefined
}

function normalizeMaxClarificationRounds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_CLARIFICATION_ROUNDS
  }
  const normalized = Math.floor(value)
  if (normalized <= 0) {
    return DEFAULT_MAX_CLARIFICATION_ROUNDS
  }
  return Math.min(normalized, MAX_CLARIFICATION_ROUNDS_LIMIT)
}

function buildPromptWithClarificationAnswers(
  prompt: string,
  clarificationAnswers?: Record<string, string>
): string {
  if (!clarificationAnswers || typeof clarificationAnswers !== 'object') {
    return prompt
  }

  const entries = Object.entries(clarificationAnswers)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
    .filter(([, value]) => value.length > 0)

  if (entries.length === 0) {
    return prompt
  }

  const lines = entries.map(([key, value]) => `${key}: ${value}`).join('\n')
  return `${prompt}\n\n[Clarification Answers]\n${lines}`
}

function getClarificationScope(taskId: string | undefined, runId: string): { taskId: string } | { runId: string } {
  return taskId ? { taskId } : { runId }
}

function getNextClarificationRound(taskId: string | undefined, runId: string): number {
  const scopeFilter = getClarificationScope(taskId, runId)
  const clarificationRounds = approvalCoordinator.list({
    ...scopeFilter,
    kind: 'question',
    source: 'clarification',
  }).length
  return clarificationRounds + 1
}

function hasPendingClarification(taskId: string | undefined, runId: string): boolean {
  const scopeFilter = getClarificationScope(taskId, runId)
  return approvalCoordinator.listPending({
    ...scopeFilter,
    kind: 'question',
    source: 'clarification',
  }).length > 0
}

function normalizeDependsOnTurnIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeConversationHistory(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return []

  const normalized = raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const record = item as Record<string, unknown>
      const roleRaw = typeof record.role === 'string' ? record.role.trim().toLowerCase() : ''
      const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system'
        ? roleRaw
        : ''
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (!role || !content) {
        return null
      }
      return {
        role: role as ConversationMessage['role'],
        content,
      } satisfies ConversationMessage
    })
    .filter((item): item is ConversationMessage => !!item)

  const maxHistoryMessages = 24
  return normalized.length <= maxHistoryMessages
    ? normalized
    : normalized.slice(-maxHistoryMessages)
}

async function emitSseMessage(
  s: {
    write: (chunk: string) => unknown
  },
  message: AgentMessage
): Promise<void> {
  const eventName = message.type || 'message'
  await Promise.resolve(s.write(`event: ${eventName}\n`))
  await Promise.resolve(s.write(`data: ${JSON.stringify(message)}\n\n`))
}

function buildTurnStateMessage(turn: TurnRecord): AgentMessage {
  const runtime = turnRuntimeStore.getRuntime(turn.taskId)
  return {
    id: generateId('msg'),
    type: 'turn_state',
    timestamp: Date.now(),
    turn: {
      taskId: turn.taskId,
      turnId: turn.id,
      state: turn.state,
      taskVersion: runtime?.version ?? 0,
      readVersion: turn.readVersion,
      writeVersion: turn.writeVersion,
      blockedByTurnIds: turn.blockedByTurnIds,
      reason: turn.reason,
    },
  }
}

async function emitTurnStateMessage(
  s: {
    write: (chunk: string) => unknown
  },
  result: TurnTransitionResult | { turn: TurnRecord | null }
): Promise<void> {
  if (!result.turn) return
  await emitSseMessage(s, buildTurnStateMessage(result.turn))
}

function detectPreflightClarification(prompt: string): PendingQuestion | null {
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
    id: generateId('q'),
    question: '需要先确认目标项目路径。请提供要读取的项目目录（绝对路径或相对当前工作区路径）。',
    options: ['读取当前工作区（默认）', '我提供项目路径'],
    allowFreeText: true,
  }
}

function addToolToAutoAllowList(toolName: string): { updated: boolean; tools: string[] } {
  const normalizedTool = toolName.trim()
  if (!normalizedTool) {
    const currentTools = normalizeApprovalSettings(getSettings()?.approval).autoAllowTools
    return { updated: false, tools: currentTools }
  }

  const currentSettings = getSettings() || {
    activeProviderId: null,
    providers: [],
  } satisfies Settings
  const currentApproval = normalizeApprovalSettings(currentSettings.approval)
  const currentTools = currentApproval.autoAllowTools
  if (currentTools.includes(normalizedTool)) {
    return { updated: false, tools: currentTools }
  }

  const nextApproval = normalizeApprovalSettings({
    ...currentApproval,
    autoAllowTools: [...currentTools, normalizedTool],
  })
  const nextSettings: Settings = {
    ...currentSettings,
    approval: nextApproval,
  }
  setSettings(nextSettings)
  saveSettingsToFile(nextSettings)

  return {
    updated: true,
    tools: nextApproval.autoAllowTools,
  }
}

export const agentNewRoutes = new Hono()

/**
 * POST /agent/plan
 * Phase 1: Generate execution plan using LLM
 * Body: {
 *   prompt: string,
 *   sessionId?: string,
 *   taskId?: string,
 *   clarificationAnswers?: Record<string, string>,
 *   maxClarificationRounds?: number
 * }
 * Response: SSE stream of AgentMessage (including plan)
 */
agentNewRoutes.post('/plan', async (c) => {
  if (!agentService || !agentServiceConfig) {
    return getAgentServiceUnavailableResponse(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const {
    prompt,
    taskId,
    clarificationAnswers,
    maxClarificationRounds,
    sessionId: existingSessionId,
    turnId: requestedTurnId,
    readVersion,
    dependsOnTurnIds,
    conversation: rawConversation,
  } = body

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  // Create a new run for planning phase
  const run = createRun('plan')
  const effectiveMaxClarificationRounds = normalizeMaxClarificationRounds(maxClarificationRounds)
  const planningPrompt = buildPromptWithClarificationAnswers(prompt, clarificationAnswers)
  const normalizedTaskId = typeof taskId === 'string' && taskId.trim()
    ? taskId.trim()
    : undefined
  const normalizedTurnId = typeof requestedTurnId === 'string' && requestedTurnId.trim()
    ? requestedTurnId.trim()
    : undefined
  const normalizedReadVersion = typeof readVersion === 'number' && Number.isFinite(readVersion)
    ? Math.max(0, Math.floor(readVersion))
    : undefined
  const normalizedDependsOnTurnIds = normalizeDependsOnTurnIds(dependsOnTurnIds)
  const conversation = normalizeConversationHistory(rawConversation)

  let activeTurn: TurnRecord | null = null
  if (normalizedTaskId) {
    const turnResult = turnRuntimeStore.createTurn({
      taskId: normalizedTaskId,
      prompt: planningPrompt,
      runId: run.id,
      turnId: normalizedTurnId,
      readVersion: normalizedReadVersion,
      dependsOnTurnIds: normalizedDependsOnTurnIds,
    })
    activeTurn = turnResult.turn
  }

  c.header('Content-Type', 'text/event-stream; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    try {
      // Always emit runtime session metadata first so frontend can correlate follow-up approvals.
      const sessionMessage: AgentMessage = {
        id: generateId('msg'),
        type: 'session',
        sessionId: run.id,
        timestamp: Date.now(),
      }
      await emitSseMessage(s, sessionMessage)

      const maybeEmitBlockedClarificationLimitError = async (): Promise<boolean> => {
        const pendingClarification = hasPendingClarification(normalizedTaskId, run.id)
        if (!pendingClarification) {
          return false
        }

        const nextRound = getNextClarificationRound(normalizedTaskId, run.id)
        if (nextRound <= effectiveMaxClarificationRounds) {
          return false
        }

        const limitError: AgentMessage = {
          id: generateId('msg'),
          type: 'error',
          errorMessage: `澄清轮次超过上限（${effectiveMaxClarificationRounds}）。请补充更完整需求后重试。`,
          timestamp: Date.now(),
        }
        await emitSseMessage(s, limitError)

        if (activeTurn) {
          const failed = turnRuntimeStore.failTurn(activeTurn.id, limitError.errorMessage)
          if (failed.turn) {
            activeTurn = failed.turn
            await emitTurnStateMessage(s, failed)
          }
        }

        const doneMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'done',
          timestamp: Date.now(),
        }
        await emitSseMessage(s, doneMessage)
        return true
      }

      if (activeTurn) {
        // If this turn is blocked by dependencies, return early with a clear state snapshot.
        if (activeTurn.state === 'blocked') {
          if (await maybeEmitBlockedClarificationLimitError()) {
            return
          }
          await emitTurnStateMessage(s, { turn: activeTurn })
          const blockedMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'text',
            role: 'assistant',
            content: buildBlockedTurnUserMessage(activeTurn.blockedByTurnIds),
            timestamp: Date.now(),
          }
          await emitSseMessage(s, blockedMessage)
          const doneMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'done',
            timestamp: Date.now(),
          }
          await emitSseMessage(s, doneMessage)
          return
        }

        const planningState = turnRuntimeStore.markTurnPlanning(activeTurn.id)
        if (planningState.status === 'blocked' && planningState.turn) {
          activeTurn = planningState.turn
          if (await maybeEmitBlockedClarificationLimitError()) {
            return
          }
          await emitTurnStateMessage(s, planningState)
          const blockedMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'text',
            role: 'assistant',
            content: buildBlockedTurnUserMessage(planningState.turn.blockedByTurnIds),
            timestamp: Date.now(),
          }
          await emitSseMessage(s, blockedMessage)
          const doneMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'done',
            timestamp: Date.now(),
          }
          await emitSseMessage(s, doneMessage)
          return
        }
        if (planningState.status !== 'ok' || !planningState.turn) {
          const errorMsg: AgentMessage = {
            id: generateId('msg'),
            type: 'error',
            errorMessage: planningState.reason || '回合状态冲突，无法进入规划阶段。',
            timestamp: Date.now(),
          }
          await emitSseMessage(s, errorMsg)
          const doneMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'done',
            timestamp: Date.now(),
          }
          await emitSseMessage(s, doneMessage)
          return
        }
        activeTurn = planningState.turn
        await emitTurnStateMessage(s, planningState)
      }

      const preflightClarification = detectPreflightClarification(planningPrompt)
      if (preflightClarification) {
        const nextRound = getNextClarificationRound(normalizedTaskId, run.id)
        if (nextRound > effectiveMaxClarificationRounds) {
          const limitError: AgentMessage = {
            id: generateId('msg'),
            type: 'error',
            errorMessage: `澄清轮次超过上限（${effectiveMaxClarificationRounds}）。请补充更完整需求后重试。`,
            timestamp: Date.now(),
          }
          await emitSseMessage(s, limitError)

          if (activeTurn) {
            const failed = turnRuntimeStore.failTurn(activeTurn.id, limitError.errorMessage)
            if (failed.turn) {
              activeTurn = failed.turn
              await emitTurnStateMessage(s, failed)
            }
          }

          const doneMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'done',
            timestamp: Date.now(),
          }
          await emitSseMessage(s, doneMessage)
          return
        }

        approvalCoordinator.captureQuestionRequest(preflightClarification, {
          taskId: normalizedTaskId,
          runId: run.id,
          providerSessionId: run.id,
          source: 'clarification',
          round: nextRound,
        })

        const clarificationMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'clarification_request',
          role: 'assistant',
          content: preflightClarification.question,
          clarification: preflightClarification,
          question: preflightClarification,
          timestamp: Date.now(),
        }
        await emitSseMessage(s, clarificationMessage)
        if (activeTurn) {
          const awaiting = turnRuntimeStore.markTurnAwaitingClarification(activeTurn.id)
          if (awaiting.turn) {
            activeTurn = awaiting.turn
            await emitTurnStateMessage(s, awaiting)
          }
        }

        const doneMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'done',
          timestamp: Date.now(),
        }
        await emitSseMessage(s, doneMessage)
        return
      }

      // Use agent service to generate plan via LLM
      const agent = agentService!.createAgent()
      let planResult: TaskPlan | null = null
      let isDirectAnswer = false
      let directAnswer = ''
      let sawPlaceholderText = false
      let clarificationLimitExceeded = false

      for await (const message of agent.plan!(planningPrompt, {
        sessionId: run.id,
        cwd: agentServiceConfig?.workDir,
        conversation,
      })) {
        if (run.isAborted) {
          break
        }

        if (message.type === 'clarification_request') {
          const clarification = message.clarification || message.question
          if (clarification) {
            const nextRound = getNextClarificationRound(normalizedTaskId, run.id)

            if (nextRound > effectiveMaxClarificationRounds) {
              clarificationLimitExceeded = true
              const limitError: AgentMessage = {
                id: generateId('msg'),
                type: 'error',
                errorMessage: `澄清轮次超过上限（${effectiveMaxClarificationRounds}）。请补充更完整需求后重试。`,
                timestamp: Date.now(),
              }
              await emitSseMessage(s, limitError)
              if (activeTurn) {
                const failed = turnRuntimeStore.failTurn(activeTurn.id, limitError.errorMessage)
                if (failed.turn) {
                  activeTurn = failed.turn
                  await emitTurnStateMessage(s, failed)
                }
              }
              break
            }

            approvalCoordinator.captureQuestionRequest(clarification, {
              taskId: normalizedTaskId,
              runId: run.id,
              providerSessionId: run.id,
              source: 'clarification',
              round: nextRound,
            })
          }
        } else {
          capturePendingInteraction(message, {
            taskId: normalizedTaskId,
            runId: run.id,
            providerSessionId: run.id,
          })
        }

        // Capture plan from message
        if (message.type === 'plan' && message.plan) {
          planResult = message.plan as TaskPlan
          planStore.upsertPendingPlan(planResult, {
            taskId: normalizedTaskId,
            runId: run.id,
            turnId: activeTurn?.id,
          })
        }

        // Capture direct answer
        if (message.type === 'text' && message.role === 'assistant') {
          const content = (message.content || '').trim()
          if (content) {
            directAnswer = content
            if (isLikelyPlanningPlaceholderText(content)) {
              sawPlaceholderText = true
            } else {
              isDirectAnswer = true
            }
          }
        }

        // Session event is already emitted by route for both normal and preflight paths.
        if (message.type === 'session') {
          continue
        }

        // Forward message to client
        await emitSseMessage(s, message)
      }

      if (run.isAborted) {
        if (activeTurn) {
          const canceled = turnRuntimeStore.cancelTurn(activeTurn.id, 'Planning aborted by user.')
          if (canceled.turn) {
            activeTurn = canceled.turn
            await emitTurnStateMessage(s, canceled)
          }
        }
        const doneMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'done',
          timestamp: Date.now(),
        }
        await emitSseMessage(s, doneMessage)
        return
      }

      if (clarificationLimitExceeded) {
        const doneMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'done',
          timestamp: Date.now(),
        }
        await emitSseMessage(s, doneMessage)
        return
      }

      // Guardrail: placeholder planning text should not terminate the planning flow.
      if (!planResult && sawPlaceholderText && !isDirectAnswer) {
        const fallbackPlan = createFallbackPlanningPlan(prompt, directAnswer)
        planResult = fallbackPlan
        planStore.upsertPendingPlan(fallbackPlan, {
          taskId: normalizedTaskId,
          runId: run.id,
          turnId: activeTurn?.id,
        })

        const fallbackPlanMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'plan',
          role: 'assistant',
          content: `已生成执行计划，共 ${fallbackPlan.steps.length} 个步骤`,
          timestamp: Date.now(),
          plan: fallbackPlan,
        }
        await emitSseMessage(s, fallbackPlanMessage)
      }

      // If it was a direct answer, no need for approval
      if (isDirectAnswer && !planResult) {
        const doneMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'done',
          timestamp: Date.now(),
        }
        if (activeTurn) {
          const completed = turnRuntimeStore.completeTurn(activeTurn.id, directAnswer)
          if (completed.turn) {
            activeTurn = completed.turn
            await emitTurnStateMessage(s, completed)
          }
        }
        await emitSseMessage(s, doneMessage)
        return
      }

      if (planResult && activeTurn) {
        const awaiting = turnRuntimeStore.markTurnAwaitingApproval(activeTurn.id)
        if (awaiting.turn) {
          activeTurn = awaiting.turn
          await emitTurnStateMessage(s, awaiting)
        }
      }

      // Send done message
      const doneMessage: AgentMessage = {
        id: generateId('msg'),
        type: 'done',
        timestamp: Date.now(),
      }
      await emitSseMessage(s, doneMessage)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorMsg: AgentMessage = {
        id: generateId('msg'),
        type: 'error',
        errorMessage,
        timestamp: Date.now(),
      }
      if (activeTurn) {
        const failed = turnRuntimeStore.failTurn(activeTurn.id, errorMessage)
        if (failed.turn) {
          activeTurn = failed.turn
          await emitTurnStateMessage(s, failed)
        }
      }
      await emitSseMessage(s, errorMsg)
    } finally {
      deleteRun(run.id)
    }
  })
})

/**
 * POST /agent/execute
 * Phase 2: Execute approved plan
 * Body: { planId: string, prompt: string, workDir?: string, taskId?: string, attachments?: MessageAttachment[] }
 * Response: SSE stream of AgentMessage
 */
agentNewRoutes.post('/execute', async (c) => {
  if (!agentService || !agentServiceConfig) {
    return getAgentServiceUnavailableResponse(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const {
    planId,
    prompt,
    workDir,
    taskId,
    attachments,
    sessionId: existingSessionId,
    turnId: requestedTurnId,
    readVersion,
  } = body

  if (!planId) {
    return c.json({ error: 'planId is required' }, 400)
  }

  // Create a new run for execution phase
  const run = createRun('execute')
  const normalizedTaskId = typeof taskId === 'string' && taskId.trim()
    ? taskId.trim()
    : undefined
  const normalizedTurnId = typeof requestedTurnId === 'string' && requestedTurnId.trim()
    ? requestedTurnId.trim()
    : undefined
  const normalizedReadVersion = typeof readVersion === 'number' && Number.isFinite(readVersion)
    ? Math.max(0, Math.floor(readVersion))
    : undefined

  const existingPlanRecord = planStore.getRecord(planId)
  const effectiveTaskId = normalizedTaskId || existingPlanRecord?.taskId || undefined
  const resolvedTurnId = normalizedTurnId || existingPlanRecord?.turnId || undefined
  let activeTurn: TurnRecord | null = null
  if (resolvedTurnId) {
    const boundTurn = turnRuntimeStore.getTurn(resolvedTurnId)
    if (boundTurn && (!effectiveTaskId || boundTurn.taskId === effectiveTaskId)) {
      activeTurn = boundTurn
    }
  } else if (effectiveTaskId) {
    activeTurn = turnRuntimeStore.findLatestTurnByTask(effectiveTaskId, ['awaiting_approval', 'executing'])
  }

  const startExecutionResult = planStore.startExecution(planId, {
    taskId: effectiveTaskId,
    runId: run.id,
    turnId: activeTurn?.id,
  })
  if (startExecutionResult.status === 'not_found') {
    deleteRun(run.id)
    return c.json({ error: 'Plan not found', code: 'PLAN_NOT_FOUND' }, 404)
  }
  if (startExecutionResult.status === 'conflict') {
    if (startExecutionResult.record.status === 'expired') {
      cancelTurnsForExpiredPlans([startExecutionResult.record])
    }
    deleteRun(run.id)
    return c.json({
      error: 'Plan is not executable',
      code: 'PLAN_STATE_CONFLICT',
      planStatus: startExecutionResult.record.status,
    }, 409)
  }
  const plan = startExecutionResult.plan

  if (activeTurn) {
    const turnStartResult = turnRuntimeStore.startExecution(
      activeTurn.id,
      normalizedReadVersion
    )
    if (turnStartResult.status !== 'ok' || !turnStartResult.turn) {
      planStore.markOrphaned(
        planId,
        turnStartResult.reason || 'Turn start conflict during execution.',
        turnStartResult.code === 'TURN_VERSION_CONFLICT' ? 'version_conflict' : 'execution_error'
      )
      deleteRun(run.id)
      return c.json({
        error: turnStartResult.reason || 'Turn is not executable',
        code: turnStartResult.code || 'TURN_STATE_CONFLICT',
        turnState: turnStartResult.turn?.state || null,
        taskVersion: turnStartResult.runtime?.version ?? null,
      }, 409)
    }
    activeTurn = turnStartResult.turn
  }

  const effectiveWorkDir = workDir || agentServiceConfig?.workDir || process.cwd()
  const executionTaskId = effectiveTaskId || run.id
  const planningFilesBootstrap = await bootstrapPlanningFiles({
    workDir: effectiveWorkDir,
    taskId: executionTaskId,
    goal: plan.goal,
    steps: plan.steps.map((step) => step.description),
    notes: plan.notes,
    originalPrompt: typeof prompt === 'string' ? prompt : '',
  })
  if (planningFilesBootstrap.error) {
    console.warn('[agent-new] Failed to bootstrap planning files:', planningFilesBootstrap.error)
  }
  const progressFilePath = path.join(planningFilesBootstrap.sessionDir, 'progress.md')

  c.header('Content-Type', 'text/event-stream; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    let executionStarted = false
    let abortedByUser = false
    let executionFailed = false
    let executionAwaitingUser = false
    let executionFailureReason = 'Execution failed before completion.'
    let runtimeGateResult: RuntimeGateResult | null = null
    const executionSummary: ExecutionCompletionSummary = {
      toolUseCount: 0,
      toolResultCount: 0,
      meaningfulToolUseCount: 0,
      browserToolUseCount: 0,
      assistantTextCount: 0,
      meaningfulAssistantTextCount: 0,
      preambleAssistantTextCount: 0,
      resultMessageCount: 0,
      latestTodoSnapshot: null,
      pendingInteractionCount: 0,
      blockerCandidate: null,
      blockedArtifactPath: null,
    }
    try {
      executionStarted = true
      // Send runtime session info
      const sessionMessage: AgentMessage = {
        id: generateId('msg'),
        type: 'session',
        sessionId: run.id,
        timestamp: Date.now(),
      }
      await emitSseMessage(s, sessionMessage)
      if (activeTurn) {
        await emitSseMessage(s, buildTurnStateMessage(activeTurn))
      }

      // Execute using the agent service with plan context
      // Create agent and format plan for execution
      const formattingAgent = agentService!.createAgent()
      const executionPrompt = buildExecutionPrompt(
        plan,
        prompt,
        effectiveWorkDir,
        formattingAgent.formatPlanForExecution
          ? ((planData, dir) => formattingAgent.formatPlanForExecution!(planData, dir))
          : undefined
      )
      await appendProgressEntry(
        progressFilePath,
        buildExecutionContextLogLines(typeof prompt === 'string' ? prompt : '', plan)
      )
      const runtimeGateRequired = isRuntimeRunIntent(typeof prompt === 'string' ? prompt : '', plan)
      const browserAutomationIntent = isBrowserAutomationIntent(typeof prompt === 'string' ? prompt : '', plan)
      const maxExecutionAttempts = runtimeGateRequired ? MAX_RUNTIME_REPAIR_ATTEMPTS + 1 : 1
      let runtimeGatePassed = !runtimeGateRequired

      for (let attempt = 0; attempt < maxExecutionAttempts; attempt += 1) {
        const observation = createExecutionObservation()
        const isRepairAttempt = attempt > 0
        const promptForAttempt = isRepairAttempt && runtimeGateResult
          ? buildRuntimeRepairPrompt(executionPrompt, runtimeGateResult, effectiveWorkDir)
          : executionPrompt

        if (isRepairAttempt && runtimeGateResult) {
          const autoRepairMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'text',
            role: 'assistant',
            content: `运行校验未通过，开始自动修复（第 ${attempt + 1} 次尝试）：${runtimeGateResult.reason}`,
            timestamp: Date.now(),
          }
          await emitSseMessage(s, autoRepairMessage)
          await appendProgressEntry(progressFilePath, [
            `### Runtime Auto Repair (${new Date().toISOString()})`,
            `- Attempt: ${attempt + 1}/${maxExecutionAttempts}`,
            `- Reason: ${runtimeGateResult.reason}`,
          ])
        }

        let attemptFailed = false
        for await (const message of agentService!.streamExecution(
          promptForAttempt,
          run.id,
          attachments as MessageAttachment[] | undefined,
          undefined,
          {
            workDir: effectiveWorkDir,
            taskId: executionTaskId,
          }
        )) {
          if (run.isAborted) {
            abortedByUser = true
            break
          }

          capturePendingInteraction(message, {
            taskId,
            runId: run.id,
            providerSessionId: run.id,
          })
          collectExecutionObservation(message, observation)

          const blockerCandidate = browserAutomationIntent && message.type === 'tool_result' && typeof message.toolOutput === 'string'
            ? detectBrowserToolBlockerText(parseToolOutputText(message.toolOutput))
            : buildExecutionBlockerCandidate(message, {
              trustAssistantText: !browserAutomationIntent,
              browserAutomationIntent,
            })
          if (blockerCandidate) {
            executionSummary.blockerCandidate = blockerCandidate
          }

          const blockedArtifactPath = detectBlockedArtifactPath(message)
          if (blockedArtifactPath) {
            executionSummary.blockedArtifactPath = blockedArtifactPath
          }

          if (message.type === 'tool_use') {
            executionSummary.toolUseCount += 1
            if (!isPreparatoryToolUse(message.toolName)) {
              executionSummary.meaningfulToolUseCount += 1
            }
            if (isBrowserAutomationToolUse(message.toolName)) {
              executionSummary.browserToolUseCount += 1
            }
          }
          if (message.type === 'tool_result') executionSummary.toolResultCount += 1
          if (message.type === 'text' && message.role !== 'user' && message.content?.trim()) {
            executionSummary.assistantTextCount += 1
            if (isExecutionPreambleText(message.content)) {
              executionSummary.preambleAssistantTextCount += 1
            } else {
              executionSummary.meaningfulAssistantTextCount += 1
            }
          }
          if (message.type === 'result' && message.content?.trim()) {
            executionSummary.resultMessageCount += 1
          }

          const todoSnapshot = extractTodoProgressSnapshot(message)
          if (todoSnapshot) {
            executionSummary.latestTodoSnapshot = todoSnapshot
            const timestampIso = new Date().toISOString()
            await appendProgressEntry(progressFilePath, [
              `### Progress Update (${timestampIso})`,
              `- Completed: ${todoSnapshot.completed}/${todoSnapshot.total}`,
              `- In Progress: ${todoSnapshot.inProgress}`,
              `- Pending: ${todoSnapshot.pending}`,
              `- Failed: ${todoSnapshot.failed}`,
              todoSnapshot.currentItems.length > 0
                ? `- Current Step: ${todoSnapshot.currentItems.join(' | ')}`
                : '- Current Step: (none)',
            ])
          }

          if (message.type === 'tool_use') {
            const detail = summarizeToolInput(message.toolInput)
            await appendExecutionAudit(
              progressFilePath,
              `tool_use ${message.toolName || '(unknown)'}`,
              detail
            )
          } else if (message.type === 'tool_result') {
            await appendExecutionAudit(
              progressFilePath,
              'tool_result',
              message.toolOutput || ''
            )
          } else if (message.type === 'text' && message.role !== 'user' && message.content?.trim()) {
            await appendExecutionAudit(
              progressFilePath,
              'assistant',
              message.content
            )
          } else if (message.type === 'result' && message.content?.trim()) {
            await appendExecutionAudit(
              progressFilePath,
              'result',
              message.content
            )
          } else if (message.type === 'error' && message.errorMessage?.trim()) {
            await appendExecutionAudit(
              progressFilePath,
              'error',
              message.errorMessage
            )
          }

          if (message.type === 'error') {
            executionFailed = true
            executionFailureReason = message.errorMessage || 'Execution failed before completion.'
            attemptFailed = true
            await appendProgressEntry(progressFilePath, [
              `### Error (${new Date().toISOString()})`,
              `- ${executionFailureReason}`,
            ])
          }

          if (message.type === 'done') {
            continue
          }

          await emitSseMessage(s, message)
        }

        if (abortedByUser || executionFailed || attemptFailed) {
          break
        }

        if (!runtimeGateRequired) {
          runtimeGatePassed = true
          break
        }

        runtimeGateResult = await evaluateRuntimeGate(observation, effectiveWorkDir)
        if (runtimeGateResult.passed) {
          runtimeGatePassed = true
          await appendProgressEntry(progressFilePath, [
            `### Runtime Verification (${new Date().toISOString()})`,
            '- Status: passed',
            `- Healthy URLs: ${runtimeGateResult.healthyUrls.join(', ') || '(none)'}`,
          ])

          const runtimeResultMessage: AgentMessage = {
            id: generateId('msg'),
            type: 'result',
            role: 'assistant',
            content: runtimeGateResult.previewUrl
              ? `运行验证通过，前端预览地址：${runtimeGateResult.previewUrl}`
              : '运行验证通过。',
            timestamp: Date.now(),
          }
          executionSummary.resultMessageCount += 1
          await emitSseMessage(s, runtimeResultMessage)
          break
        }

        if (attempt < maxExecutionAttempts - 1) {
          continue
        }

        executionFailed = true
        executionFailureReason = `Runtime verification failed: ${runtimeGateResult.reason}`
        await appendProgressEntry(progressFilePath, [
          `### Runtime Verification (${new Date().toISOString()})`,
          '- Status: failed',
          `- Reason: ${runtimeGateResult.reason}`,
          `- Checked URLs: ${runtimeGateResult.checkedUrls.join(', ') || '(none)'}`,
          `- Healthy URLs: ${runtimeGateResult.healthyUrls.join(', ') || '(none)'}`,
        ])
        const runtimeErrorMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'error',
          errorMessage: executionFailureReason,
          timestamp: Date.now(),
        }
        await emitSseMessage(s, runtimeErrorMessage)
      }

      if (runtimeGateRequired && !runtimeGatePassed && !executionFailed && !abortedByUser) {
        executionFailed = true
        executionFailureReason = 'Runtime verification failed after execution.'
      }

      if (!executionFailed && !abortedByUser) {
        executionSummary.pendingInteractionCount = approvalCoordinator.listPending({
          taskId: executionTaskId,
          providerSessionId: run.id,
        }).length

        const blockerCandidate = executionSummary.blockerCandidate
        if (executionSummary.pendingInteractionCount > 0 || blockerCandidate) {
          let userActionMessage = blockerCandidate?.userMessage || '执行需要你的输入后才能继续，请处理后回复我继续。'

          if (executionSummary.pendingInteractionCount === 0) {
            const question = buildExecutionBlockedQuestion(blockerCandidate || {
              reason: 'Execution is waiting for user input.',
              userMessage: userActionMessage,
            })

            approvalCoordinator.captureQuestionRequest(question, {
              taskId: executionTaskId,
              runId: run.id,
              providerSessionId: run.id,
              source: 'runtime_tool_question',
            })
            executionSummary.pendingInteractionCount = approvalCoordinator.listPending({
              taskId: executionTaskId,
              providerSessionId: run.id,
            }).length

            const clarificationMessage: AgentMessage = {
              id: generateId('msg'),
              type: 'clarification_request',
              role: 'assistant',
              content: question.question,
              clarification: question,
              question,
              timestamp: Date.now(),
            }
            await emitSseMessage(s, clarificationMessage)
            userActionMessage = question.question
          }

          await appendProgressEntry(progressFilePath, [
            `### Execution Pause (${new Date().toISOString()})`,
            '- Status: waiting_for_user',
            `- Reason: ${blockerCandidate?.reason || 'Execution is waiting for user input.'}`,
            `- User Action Required: ${userActionMessage}`,
          ])

          if (activeTurn) {
            const awaiting = turnRuntimeStore.markTurnAwaitingClarification(activeTurn.id)
            if (awaiting.turn) {
              activeTurn = awaiting.turn
              await emitTurnStateMessage(s, awaiting)
            }
          }

          executionAwaitingUser = true
        }

        if (executionAwaitingUser) {
          // The current execution run is intentionally paused for user input.
        } else {
          const incompleteReason = detectIncompleteExecution(
            executionSummary,
            typeof prompt === 'string' ? prompt : '',
            plan
          )
          if (incompleteReason) {
            executionFailed = true
            executionFailureReason = incompleteReason
            console.warn(`[agent-new] Suspicious execution completion for plan ${planId}: ${formatExecutionCompletionSummary(executionSummary)}`)
            const incompleteMessage: AgentMessage = {
              id: generateId('msg'),
              type: 'error',
              errorMessage: executionFailureReason,
              timestamp: Date.now(),
            }
            await emitSseMessage(s, incompleteMessage)
          } else {
            console.info(`[agent-new] Execution summary for plan ${planId}: ${formatExecutionCompletionSummary(executionSummary)}`)
          }
        }
      }
    } catch (error) {
      executionFailed = true
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      executionFailureReason = errorMessage
      const errorMsg: AgentMessage = {
        id: generateId('msg'),
        type: 'error',
        errorMessage,
        timestamp: Date.now(),
      }
      await emitSseMessage(s, errorMsg)
    } finally {
      deleteRun(run.id)
      if (executionStarted) {
        if (abortedByUser) {
          planStore.markOrphaned(planId, 'Execution aborted by user.', 'user_cancelled')
          await appendProgressEntry(progressFilePath, [
            `### Execution End (${new Date().toISOString()})`,
            '- Status: canceled',
            '- Reason: Execution aborted by user.',
          ])
          if (activeTurn) {
            const canceled = turnRuntimeStore.cancelTurn(activeTurn.id, 'Execution aborted by user.')
            if (canceled.turn) {
              activeTurn = canceled.turn
            }
          }
        } else if (executionFailed) {
          planStore.markOrphaned(planId, executionFailureReason, 'execution_error')
          await appendProgressEntry(progressFilePath, [
            `### Execution End (${new Date().toISOString()})`,
            '- Status: failed',
            `- Reason: ${executionFailureReason}`,
            `- Summary: ${formatExecutionCompletionSummary(executionSummary)}`,
          ])
          if (activeTurn) {
            const failed = turnRuntimeStore.failTurn(activeTurn.id, executionFailureReason)
            if (failed.turn) {
              activeTurn = failed.turn
            }
          }
        } else if (executionAwaitingUser) {
          await appendProgressEntry(progressFilePath, [
            `### Execution End (${new Date().toISOString()})`,
            '- Status: waiting_for_user',
            `- Summary: ${formatExecutionCompletionSummary(executionSummary)}`,
          ])
        } else {
          planStore.markExecuted(planId)
          await appendProgressEntry(progressFilePath, [
            `### Execution End (${new Date().toISOString()})`,
            '- Status: completed',
            `- Plan: ${planId}`,
            `- Summary: ${formatExecutionCompletionSummary(executionSummary)}`,
          ])
          if (activeTurn) {
            const completed = turnRuntimeStore.completeTurn(activeTurn.id, `Execution completed for plan ${planId}`)
            if (completed.turn) {
              activeTurn = completed.turn
            }
          }
        }
        if (activeTurn) {
          await emitSseMessage(s, buildTurnStateMessage(activeTurn))
        }
        const doneMessage: AgentMessage = {
          id: generateId('msg'),
          type: 'done',
          timestamp: Date.now(),
        }
        await emitSseMessage(s, doneMessage)
      }
    }
  })
})

/**
 * POST /agent
 * Direct execution (compatibility mode)
 * Body: { prompt: string, sessionId?: string, attachments?: MessageAttachment[], conversation?: ConversationMessage[] }
 * Response: SSE stream of AgentMessage
 */
agentNewRoutes.post('/', async (c) => {
  if (!agentService) {
    return getAgentServiceUnavailableResponse(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const { prompt, sessionId, attachments, conversation } = body

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  c.header('Content-Type', 'text/event-stream; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    try {
      for await (const message of agentService!.streamExecution(prompt, sessionId, attachments, conversation)) {
        capturePendingInteraction(message, {
          runId: sessionId,
          providerSessionId: sessionId,
        })
        s.write(`event: ${message.type}\n`)
        s.write(`data: ${JSON.stringify(message)}\n\n`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      s.write(`event: error\n`)
      s.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
    }
  })
})

/**
 * POST /agent/stop/:id
 * Stop a running run
 */
agentNewRoutes.post('/stop/:id', async (c) => {
  const sessionId = c.req.param('id')

  const run = activeRuns.get(sessionId)
  if (run) {
    run.isAborted = true
    run.abortController.abort()
    const activeTurn = turnRuntimeStore.findLatestTurnByRun(sessionId, [
      'planning',
      'awaiting_approval',
      'awaiting_clarification',
      'executing',
      'blocked',
      'queued',
    ])
    if (activeTurn) {
      turnRuntimeStore.cancelTurn(activeTurn.id, 'Session stopped by user.')
    }
    deleteRun(sessionId)
    return c.json({ success: true })
  }

  // Also try to abort via agent service
  if (agentService) {
    agentService.abort(sessionId)
  }

  return c.json({ success: false, error: 'Session not found' }, 404)
})

/**
 * GET /agent/run/:id
 * Get runtime run status
 */
const handleGetRunStatus = async (c: any) => {
  const sessionId = c.req.param('id')
  const run = activeRuns.get(sessionId)

  if (!run) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json({
    id: run.id,
    phase: run.phase,
    isAborted: run.isAborted,
    createdAt: run.createdAt,
  })
}

agentNewRoutes.get('/run/:id', handleGetRunStatus)
agentNewRoutes.get('/session/:id', handleGetRunStatus)

/**
 * GET /agent/plan/:id
 * Get plan details
 */
agentNewRoutes.get('/plan/:id', async (c) => {
  const planId = c.req.param('id')
  const plan = planStore.getPlan(planId)

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  return c.json(plan)
})

/**
 * GET /agent/runtime/:taskId
 * Get task runtime/turn/artifact snapshot for recovery and dependency inspection.
 */
agentNewRoutes.get('/runtime/:taskId', async (c) => {
  const taskId = c.req.param('taskId')
  if (!taskId) {
    return c.json({ error: 'taskId is required' }, 400)
  }

  const runtime = turnRuntimeStore.getRuntime(taskId)
  const turns = turnRuntimeStore.listTurns(taskId)
  const artifacts = turnRuntimeStore.listArtifacts(taskId)

  return c.json({
    taskId,
    runtime,
    turns,
    artifacts,
  })
})

/**
 * GET /agent/turn/:turnId
 * Inspect a single turn state.
 */
agentNewRoutes.get('/turn/:turnId', async (c) => {
  const turnId = c.req.param('turnId')
  if (!turnId) {
    return c.json({ error: 'turnId is required' }, 400)
  }
  const turn = turnRuntimeStore.getTurn(turnId)
  if (!turn) {
    return c.json({ error: 'Turn not found' }, 404)
  }
  const runtime = turnRuntimeStore.getRuntime(turn.taskId)
  return c.json({
    turn,
    runtime,
  })
})

/**
 * POST /agent/plan/reject
 * Mark a pending plan as rejected by user
 * Body: { planId: string, reason?: string }
 */
agentNewRoutes.post('/plan/reject', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { planId, reason } = body as { planId?: string; reason?: string }

  if (!planId) {
    return c.json({ error: 'planId is required' }, 400)
  }

  const record = planStore.markRejected(planId, reason)
  if (!record) {
    return c.json({ error: 'Plan not found', code: 'PLAN_NOT_FOUND' }, 404)
  }
  if (record.turnId) {
    turnRuntimeStore.cancelTurn(record.turnId, reason || 'Plan rejected by user.')
  }

  return c.json({
    success: true,
    planId,
    planStatus: record.status,
  })
})

/**
 * GET /agent/pending
 * Get pending permission/question requests (for refresh/recovery)
 */
agentNewRoutes.get('/pending', async (c) => {
  const taskId = c.req.query('taskId') || undefined
  const runId = c.req.query('runId') || c.req.query('sessionId') || undefined
  const kind = normalizeApprovalKind(c.req.query('kind'))

  const pendingItems = approvalCoordinator.listPending({
    taskId,
    runId,
    kind,
  })

  const pendingPermissions = pendingItems
    .filter((item) => item.kind === 'permission')
    .map((item) => item.permission)
    .filter((item): item is PermissionRequest => !!item)

  const pendingQuestions = pendingItems
    .filter((item) => item.kind === 'question')
    .reduce<PendingQuestion[]>((acc, item) => {
      if (!item.question) return acc
      acc.push({
        ...item.question,
        source: item.source || undefined,
        round: item.round ?? undefined,
      })
      return acc
    }, [])

  const latestTerminal = approvalCoordinator.getLatestTerminal({
    taskId,
    runId,
    kind,
  })

  return c.json({
    pendingPermissions,
    pendingQuestions,
    pendingCount: pendingItems.length,
    latestTerminal,
  })
})

/**
 * GET /agent/approvals/diagnostics
 * Read-only diagnostics endpoint for approval states
 */
agentNewRoutes.get('/approvals/diagnostics', async (c) => {
  const taskId = c.req.query('taskId') || undefined
  const runId = c.req.query('runId') || c.req.query('sessionId') || undefined
  const kind = normalizeApprovalKind(c.req.query('kind'))
  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20

  const diagnostics = approvalCoordinator.getDiagnostics(
    {
      taskId,
      runId,
      kind,
    },
    safeLimit
  )

  return c.json({
    ...diagnostics,
    taskId: taskId || null,
    runId: runId || null,
    kind: kind || null,
    limit: safeLimit,
  })
})

/**
 * POST /agent/permission
 * Respond to a permission request
 * Body: { permissionId: string, approved: boolean, reason?: string, addToAutoAllow?: boolean }
 */
agentNewRoutes.post('/permission', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { permissionId, approved, reason, addToAutoAllow } = body

  if (!permissionId) {
    return c.json({ error: 'permissionId is required' }, 400)
  }

  if (typeof approved !== 'boolean') {
    return c.json({ error: 'approved must be boolean' }, 400)
  }

  const result = approvalCoordinator.resolvePermission(permissionId, approved, reason)
  if (result.status === 'not_found') {
    return c.json({ error: 'Permission request not found' }, 404)
  }

  let autoAllowUpdated = false
  let autoAllowToolName: string | null = null
  if (approved && addToAutoAllow === true) {
    const metadata = result.record?.permission?.metadata as Record<string, unknown> | undefined
    const toolName = typeof metadata?.toolName === 'string' ? metadata.toolName.trim() : ''
    if (toolName) {
      const updateResult = addToolToAutoAllowList(toolName)
      autoAllowUpdated = updateResult.updated
      autoAllowToolName = toolName
    }
  }

  let turn: TurnRecord | null = null
  if (result.record?.taskId) {
    turn = turnRuntimeStore.findLatestTurnByTask(result.record.taskId, [
      'executing',
      'awaiting_approval',
      'awaiting_clarification',
      'planning',
      'blocked',
    ])
  }

  return c.json({
    success: true,
    approved,
    status: result.status,
    attachedToRuntime: result.attachedToRuntime,
    turnId: turn?.id || null,
    autoAllowUpdated,
    autoAllowToolName,
  })
})

/**
 * POST /agent/question
 * Respond to a pending question
 * Body: { questionId: string, answers: Record<string, string> }
 */
agentNewRoutes.post('/question', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { questionId, answers } = body

  if (!questionId) {
    return c.json({ error: 'questionId is required' }, 400)
  }

  if (!answers || typeof answers !== 'object') {
    return c.json({ error: 'answers must be an object' }, 400)
  }

  const result = approvalCoordinator.resolveQuestion(questionId, answers)
  if (result.status === 'not_found') {
    return c.json({ error: 'Question not found' }, 404)
  }

  const nextAction =
    result.record?.source === 'clarification'
      ? 'resume_planning'
      : 'resume_execution'

  let turn: TurnRecord | null = null
  if (result.record?.taskId) {
    turn = turnRuntimeStore.findLatestTurnByTask(result.record.taskId, [
      'awaiting_clarification',
      'planning',
      'blocked',
      'queued',
      'executing',
    ])
  }

  return c.json({
    success: true,
    answers,
    status: result.status,
    attachedToRuntime: result.attachedToRuntime,
    nextAction,
    turnId: turn?.id || null,
  })
})
