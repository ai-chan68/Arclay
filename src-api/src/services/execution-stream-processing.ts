import type { AgentMessage } from '@shared-types'
import {
  buildExecutionBlockerCandidate,
  detectBlockedArtifactPath,
  detectBrowserToolBlockerText,
  type ExecutionBlockerCandidate,
  type ExecutionCompletionSummary,
  type TodoProgressSnapshot,
} from './execution-completion'

export interface ProcessExecutionStreamMessageInput {
  message: AgentMessage
  executionSummary: ExecutionCompletionSummary
  browserAutomationIntent: boolean
  progressPath: string
  appendProgressEntry: (progressPath: string, lines: string[]) => Promise<void>
  now?: Date
}

export interface ProcessExecutionStreamMessageResult {
  blockerCandidate: ExecutionBlockerCandidate | null
  blockedArtifactPath: string | null
  executionFailed: boolean
  executionFailureReason: string | null
  shouldForward: boolean
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
      return { content, status }
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

async function appendExecutionAudit(
  progressPath: string,
  label: string,
  detail: string,
  appendProgressEntry: ProcessExecutionStreamMessageInput['appendProgressEntry'],
  now: Date
): Promise<void> {
  const normalizedDetail = summarizeTextForAudit(detail)
  await appendProgressEntry(progressPath, [
    `### Tool Trace (${now.toISOString()})`,
    normalizedDetail ? `- ${label}: ${normalizedDetail}` : `- ${label}`,
  ])
}

function summarizeProviderCompletionMetadata(metadata?: Record<string, unknown> | null): string {
  if (!metadata) return ''

  const subtype = typeof metadata.providerResultSubtype === 'string' ? metadata.providerResultSubtype.trim() : ''
  const stopReason = typeof metadata.providerStopReason === 'string' ? metadata.providerStopReason.trim() : ''
  const durationMs = typeof metadata.providerDurationMs === 'number' && Number.isFinite(metadata.providerDurationMs)
    ? metadata.providerDurationMs
    : null
  const totalCostUsd = typeof metadata.providerTotalCostUsd === 'number' && Number.isFinite(metadata.providerTotalCostUsd)
    ? metadata.providerTotalCostUsd
    : null

  const parts: string[] = []
  if (subtype) parts.push(`subtype=${subtype}`)
  if (stopReason) parts.push(`stopReason=${stopReason}`)
  if (durationMs !== null) parts.push(`durationMs=${durationMs}`)
  if (totalCostUsd !== null) parts.push(`totalCostUsd=${totalCostUsd}`)
  return parts.join(', ')
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

  return ['TodoWrite', 'Read', 'Glob', 'Grep', 'LS', 'LSP'].includes(normalized)
}

function isBrowserAutomationToolUse(toolName?: string | null): boolean {
  const normalized = (toolName || '').trim()
  if (!normalized) return false

  return /^mcp__chrome-devtools__/i.test(normalized) || /playwright/i.test(normalized)
}

function classifyBrowserAutomationToolUse(
  toolName?: string | null
): 'navigation' | 'interaction' | 'snapshot' | 'screenshot' | 'eval' | 'other' {
  const normalized = (toolName || '').trim().toLowerCase()
  if (!normalized) return 'other'

  if (/(screenshot|capture_screenshot|\bpdf\b)/i.test(normalized)) {
    return 'screenshot'
  }
  if (/snapshot/i.test(normalized)) {
    return 'snapshot'
  }
  if (/(evaluate|eval|script|javascript|runtime)/i.test(normalized)) {
    return 'eval'
  }
  if (/(navigate|goto|open|reload|go_back|go_forward|tab_new|new_page)/i.test(normalized)) {
    return 'navigation'
  }
  if (/(click|press|fill|type|select|hover|drag|upload|check|uncheck|mouse|keyboard|tap|dialog)/i.test(normalized)) {
    return 'interaction'
  }

  return 'other'
}

export function parseToolOutputText(raw: string): string {
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
      // Keep raw output.
    }
  }

  return raw
}

export async function processExecutionStreamMessage(
  input: ProcessExecutionStreamMessageInput
): Promise<ProcessExecutionStreamMessageResult> {
  const now = input.now || new Date()
  const { message, executionSummary, progressPath, appendProgressEntry } = input

  const blockerCandidate = input.browserAutomationIntent
    && message.type === 'tool_result'
    && typeof message.toolOutput === 'string'
    ? detectBrowserToolBlockerText(parseToolOutputText(message.toolOutput))
    : buildExecutionBlockerCandidate(message, {
      trustAssistantText: !input.browserAutomationIntent,
      browserAutomationIntent: input.browserAutomationIntent,
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
      const browserToolKind = classifyBrowserAutomationToolUse(message.toolName)
      if (browserToolKind === 'navigation') executionSummary.browserNavigationCount += 1
      if (browserToolKind === 'interaction') executionSummary.browserInteractionCount += 1
      if (browserToolKind === 'snapshot') executionSummary.browserSnapshotCount += 1
      if (browserToolKind === 'screenshot') executionSummary.browserScreenshotCount += 1
      if (browserToolKind === 'eval') executionSummary.browserEvalCount += 1
    }
  }

  if (message.type === 'tool_result') {
    executionSummary.toolResultCount += 1
  }

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
    await appendProgressEntry(progressPath, [
      `### Progress Update (${now.toISOString()})`,
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
    await appendExecutionAudit(
      progressPath,
      `tool_use ${message.toolName || '(unknown)'}`,
      summarizeToolInput(message.toolInput),
      appendProgressEntry,
      now
    )
  } else if (message.type === 'tool_result') {
    await appendExecutionAudit(
      progressPath,
      'tool_result',
      message.toolOutput || '',
      appendProgressEntry,
      now
    )
  } else if (message.type === 'text' && message.role !== 'user' && message.content?.trim()) {
    await appendExecutionAudit(
      progressPath,
      'assistant',
      message.content,
      appendProgressEntry,
      now
    )
  } else if (message.type === 'result' && message.content?.trim()) {
    await appendExecutionAudit(
      progressPath,
      'result',
      message.content,
      appendProgressEntry,
      now
    )
  } else if (message.type === 'error' && message.errorMessage?.trim()) {
    await appendExecutionAudit(
      progressPath,
      'error',
      message.errorMessage,
      appendProgressEntry,
      now
    )
  } else if (message.type === 'done' && message.metadata) {
    const providerSummary = summarizeProviderCompletionMetadata(message.metadata)
    if (providerSummary) {
      await appendExecutionAudit(
        progressPath,
        'provider_result',
        providerSummary,
        appendProgressEntry,
        now
      )
    }
  }

  let executionFailed = false
  let executionFailureReason: string | null = null

  if (message.type === 'error') {
    executionFailed = true
    executionFailureReason = message.errorMessage || 'Execution failed before completion.'
    await appendProgressEntry(progressPath, [
      `### Error (${now.toISOString()})`,
      `- ${executionFailureReason}`,
    ])
  }

  if (message.type === 'done' && message.metadata) {
    const subtype = typeof message.metadata.providerResultSubtype === 'string'
      ? message.metadata.providerResultSubtype.trim()
      : ''
    const stopReason = typeof message.metadata.providerStopReason === 'string'
      ? message.metadata.providerStopReason.trim()
      : ''
    executionSummary.providerResultSubtype = subtype || executionSummary.providerResultSubtype
    executionSummary.providerStopReason = stopReason || executionSummary.providerStopReason
  }

  return {
    blockerCandidate,
    blockedArtifactPath,
    executionFailed,
    executionFailureReason,
    shouldForward: message.type !== 'done',
  }
}
