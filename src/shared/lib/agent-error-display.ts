import type { AgentMessage } from '@shared-types'

const CUSTOM_API_ERROR_PREFIX = '__CUSTOM_API_ERROR__|'

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

  return humanizeProviderError(fallback)
}
