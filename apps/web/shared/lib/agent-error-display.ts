import type { AgentMessage } from '@shared-types'

const CUSTOM_API_ERROR_PREFIX = '__CUSTOM_API_ERROR__|'
const FAILURE_DETAIL_PATTERNS = [
  /(^|\b)api error:/i,
  /(^|\b)error\b/i,
  /(^|\b)failed\b/i,
  /(^|\b)timeout\b/i,
  /(^|\b)conflict\b/i,
  /(^|\b)abort(?:ed)?\b/i,
  /(^|\b)interrupt(?:ed)?\b/i,
  /(^|\b)reject(?:ed)?\b/i,
  /(^|\b)cancel(?:ed|led)?\b/i,
  /(^|\b)expire(?:d)?\b/i,
  /(^|\b)blocked\b/i,
  /(^|\b)not found\b/i,
  /失败/,
  /错误/,
  /超时/,
  /冲突/,
  /终止/,
  /中断/,
  /拒绝/,
  /取消/,
  /过期/,
  /阻塞/,
  /不存在/,
]

function getLatestTurnMessages(messages: AgentMessage[]): AgentMessage[] {
  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.type === 'user' && message.role === 'user')
    ?.index ?? -1

  return lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages
}

export function isGenericCustomApiError(message?: string | null): boolean {
  return typeof message === 'string' && message.trim().startsWith(CUSTOM_API_ERROR_PREFIX)
}

export function humanizeProviderError(message?: string | null): string | null {
  if (!message) return null

  const trimmed = message.trim()
  if (!trimmed) return null

  if (isGenericCustomApiError(trimmed)) {
    const baseUrl = trimmed.slice(CUSTOM_API_ERROR_PREFIX.length)
    return baseUrl
      ? `自定义 Claude API 调用失败：${baseUrl}`
      : '自定义 Claude API 调用失败'
  }

  return trimmed
}

export function isLikelyFailureDetail(message?: string | null): boolean {
  const normalized = message?.trim()
  if (!normalized) return false
  if (isGenericCustomApiError(normalized)) return true

  return FAILURE_DETAIL_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isToolResultExecutionError(toolOutput?: string | null): boolean {
  const normalized = toolOutput?.trim()
  if (!normalized) return false

  if (/^Error:\s*result\s*\([^)]*\)\s*exceeds maximum allowed tokens\./i.test(normalized)) {
    return false
  }

  return (
    normalized.includes('<tool_use_error>') ||
    /^Error:/i.test(normalized) ||
    /^Failed\b/i.test(normalized)
  )
}

export function getPreferredFailureDetail(
  messages: AgentMessage[],
  fallback?: string | null
): string | null {
  const latestTurnMessages = getLatestTurnMessages(messages)

  const assistantApiError = [...latestTurnMessages]
    .reverse()
    .find((message) =>
      message.type === 'text' &&
      message.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.trim().startsWith('API Error:')
    )

  if (assistantApiError?.content?.trim()) {
    return assistantApiError.content.trim()
  }

  const nonGenericError = [...latestTurnMessages]
    .reverse()
    .find((message) =>
      message.type === 'error' &&
      typeof message.errorMessage === 'string' &&
      message.errorMessage.trim().length > 0 &&
      !isGenericCustomApiError(message.errorMessage)
    )

  if (nonGenericError?.errorMessage?.trim()) {
    return nonGenericError.errorMessage.trim()
  }

  const normalizedFallback = humanizeProviderError(fallback)
  return isLikelyFailureDetail(normalizedFallback) ? normalizedFallback : null
}
