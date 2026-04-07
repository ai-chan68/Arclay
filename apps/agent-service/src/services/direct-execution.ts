import type { AgentMessage, MessageAttachment } from '@shared-types'
import type { ConversationMessage } from '../core/agent/interface'

export type PrepareDirectExecutionRequestResult =
  | {
      status: 'validation_error'
      statusCode: 400
      body: { error: string }
    }
  | {
      status: 'ready'
      prompt: string
      sessionId?: string
      attachments?: MessageAttachment[]
      conversation?: ConversationMessage[]
    }

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined
}

export function prepareDirectExecutionRequest(input: {
  prompt?: unknown
  sessionId?: unknown
  attachments?: unknown
  conversation?: unknown
}): PrepareDirectExecutionRequestResult {
  if (!input.prompt) {
    return {
      status: 'validation_error',
      statusCode: 400,
      body: { error: 'prompt is required' },
    }
  }

  return {
    status: 'ready',
    prompt: String(input.prompt),
    sessionId: normalizeOptionalString(input.sessionId),
    attachments: Array.isArray(input.attachments)
      ? input.attachments as MessageAttachment[]
      : undefined,
    conversation: Array.isArray(input.conversation)
      ? input.conversation as ConversationMessage[]
      : undefined,
  }
}

export async function runDirectExecutionStream(input: {
  prompt: string
  sessionId?: string
  attachments?: MessageAttachment[]
  conversation?: ConversationMessage[]
  streamExecution: (
    prompt: string,
    sessionId?: string,
    attachments?: MessageAttachment[],
    conversation?: ConversationMessage[]
  ) => AsyncIterable<AgentMessage>
  capturePendingInteraction: (
    message: AgentMessage,
    context: { runId?: string; providerSessionId?: string }
  ) => void
  emitMessage: (message: AgentMessage) => Promise<void>
  emitError: (message: string) => Promise<void>
}): Promise<void> {
  try {
    for await (const message of input.streamExecution(
      input.prompt,
      input.sessionId,
      input.attachments,
      input.conversation
    )) {
      input.capturePendingInteraction(message, {
        runId: input.sessionId,
        providerSessionId: input.sessionId,
      })
      await input.emitMessage(message)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await input.emitError(errorMessage)
  }
}
