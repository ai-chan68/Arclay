import path from 'path'
import type { TaskPlan } from '../types/agent-new'
import type { AgentMessage } from '@shared-types'
import { isBrowserAutomationIntent } from './browser-intent'

export { isBrowserAutomationIntent } from './browser-intent'

export interface TodoProgressSnapshot {
  total: number
  completed: number
  inProgress: number
  pending: number
  failed: number
  currentItems: string[]
}

export interface ExecutionBlockerCandidate {
  reason: string
  userMessage: string
}

export interface ExecutionCompletionSummary {
  toolUseCount: number
  toolResultCount: number
  meaningfulToolUseCount: number
  browserToolUseCount: number
  browserNavigationCount: number
  browserInteractionCount: number
  browserSnapshotCount: number
  browserScreenshotCount: number
  browserEvalCount: number
  assistantTextCount: number
  meaningfulAssistantTextCount: number
  preambleAssistantTextCount: number
  resultMessageCount: number
  latestTodoSnapshot: TodoProgressSnapshot | null
  pendingInteractionCount: number
  blockerCandidate: ExecutionBlockerCandidate | null
  blockedArtifactPath: string | null
  providerResultSubtype: string | null
  providerStopReason: string | null
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

export function detectBrowserToolBlockerText(text: string): ExecutionBlockerCandidate | null {
  const normalized = normalizeInteractiveBlockerText(text)
  if (!normalized) return null

  const loginLike = /auth\.example\.test|登录|登录并授权|authorize|approval|认证|验证码|captcha/i.test(normalized)
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

export function buildExecutionBlockerCandidate(
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

export function detectBlockedArtifactPath(message: AgentMessage): string | null {
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

function isMaxTurnsProviderResult(subtype?: string | null): boolean {
  const normalized = (subtype || '').trim().toLowerCase()
  return normalized === 'max_turns' || normalized === 'error_max_turns'
}

function hasMeaningfulExecutionProgress(summary: ExecutionCompletionSummary): boolean {
  const completedTodos = summary.latestTodoSnapshot?.completed || 0
  return (
    summary.browserToolUseCount > 0 ||
    summary.meaningfulToolUseCount > 0 ||
    summary.meaningfulAssistantTextCount > 0 ||
    summary.resultMessageCount > 0 ||
    completedTodos > 0
  )
}

export function shouldTreatMaxTurnsAsInterrupted(summary: ExecutionCompletionSummary): boolean {
  return isMaxTurnsProviderResult(summary.providerResultSubtype) && hasMeaningfulExecutionProgress(summary)
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

export function detectIncompleteExecution(
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
