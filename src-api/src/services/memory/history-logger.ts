/**
 * HistoryLogger — records agent execution trace to JSONL
 *
 * Writes each AgentMessage as a HistoryRecord line to
 * {workDir}/sessions/{sessionId}/history.jsonl
 *
 * Session-type messages are filtered out.
 * Content is truncated to 2000 chars to keep JSONL manageable.
 */

import type { AgentMessage } from '@shared-types'
import type { HistoryRecord, HistoryRecordType } from './types'
import { MemoryStore } from './memory-store'

const MAX_CONTENT_LENGTH = 2000

function truncateContent(text: string): string {
  if (!text || text.length <= MAX_CONTENT_LENGTH) return text
  return text.slice(0, MAX_CONTENT_LENGTH) + '...[truncated]'
}

function mapMessageType(message: AgentMessage): HistoryRecordType | null {
  switch (message.type) {
    case 'text':
      return message.role === 'user' ? 'user_input' : 'agent_response'
    case 'tool_use':
      return 'tool_use'
    case 'tool_result':
      return 'tool_result'
    case 'error':
      return 'error'
    case 'plan':
    case 'direct_answer':
      return 'plan'
    case 'done':
    case 'result':
      return 'done'
    // Skip session, turn_state, permission_request, etc.
    default:
      return null
  }
}

function extractContent(message: AgentMessage): string {
  if (message.content) return truncateContent(message.content)

  // For tool_use, build a summary from toolName + toolInput
  if (message.type === 'tool_use' && message.toolName) {
    const inputSummary = message.toolInput
      ? JSON.stringify(message.toolInput).slice(0, 500)
      : ''
    return truncateContent(`${message.toolName}: ${inputSummary}`)
  }

  // For plan messages
  if (message.plan) {
    const plan = message.plan
    const goalOrSummary = 'goal' in plan ? plan.goal : ('summary' in plan ? plan.summary : '')
    return truncateContent(`goal: ${goalOrSummary}`)
  }

  if (message.errorMessage) return truncateContent(message.errorMessage)

  return ''
}

function extractMetadata(message: AgentMessage): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {}

  if (message.toolName) meta.toolName = message.toolName
  if (message.toolUseId) meta.toolUseId = message.toolUseId
  if (message.role) meta.role = message.role
  if (message.metadata) {
    if (message.metadata.model) meta.model = message.metadata.model
    if (message.metadata.tokenUsage) meta.tokenUsage = message.metadata.tokenUsage
  }

  return Object.keys(meta).length > 0 ? meta : undefined
}

export class HistoryLogger {
  constructor(
    private readonly store: MemoryStore,
    private readonly sessionId: string
  ) {}

  /**
   * Log an AgentMessage as a HistoryRecord.
   * Returns silently if the message type should be skipped.
   */
  async logAgentMessage(message: AgentMessage): Promise<void> {
    const type = mapMessageType(message)
    if (!type) return

    const record: HistoryRecord = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type,
      content: extractContent(message),
      metadata: extractMetadata(message),
    }

    try {
      await this.store.appendHistory(this.sessionId, record)
    } catch (err) {
      // Non-critical: log but don't interrupt agent execution
      console.warn('[HistoryLogger] Failed to write history:', err)
    }
  }

  /**
   * Log a completion marker at the end of a turn.
   */
  async logCompletion(summary?: string): Promise<void> {
    const record: HistoryRecord = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'done',
      content: summary || 'turn completed',
    }

    try {
      await this.store.appendHistory(this.sessionId, record)
    } catch (err) {
      console.warn('[HistoryLogger] Failed to write completion:', err)
    }
  }
}
