import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage, MessageAttachment } from '@shared-types'
import type { ConversationMessage } from '../../core/agent/interface'
import { prepareDirectExecutionRequest, runDirectExecutionStream } from '../direct-execution'

describe('direct-execution', () => {
  it('validates prompt and normalizes optional fields', () => {
    const invalid = prepareDirectExecutionRequest({
      prompt: '',
    })

    expect(invalid).toEqual({
      status: 'validation_error',
      statusCode: 400,
      body: {
        error: 'prompt is required',
      },
    })

    const attachments: MessageAttachment[] = [
      {
        id: 'att_1',
        name: 'spec.md',
        type: 'text/markdown',
        data: 'ZGF0YQ==',
        size: 4,
      },
    ]
    const conversation: ConversationMessage[] = [
      { role: 'user', content: '继续执行' },
    ]

    const ready = prepareDirectExecutionRequest({
      prompt: 'Run this',
      sessionId: ' session_direct ',
      attachments,
      conversation,
    })

    expect(ready).toEqual({
      status: 'ready',
      prompt: 'Run this',
      sessionId: 'session_direct',
      attachments,
      conversation,
    })
  })

  it('forwards streamed messages and captures pending interactions in direct mode', async () => {
    const message: AgentMessage = {
      id: 'permission_1',
      type: 'permission_request',
      role: 'assistant',
      content: 'Need approval',
      permission: {
        id: 'permission_1',
        toolName: 'Bash',
        command: 'pwd',
        reason: 'need cwd',
      },
      timestamp: 1,
    } as AgentMessage
    const streamExecution = vi.fn(async function* () {
      yield message
    })
    const capturePendingInteraction = vi.fn()
    const emitMessage = vi.fn(async () => {})
    const emitError = vi.fn(async () => {})

    await runDirectExecutionStream({
      prompt: 'Run this',
      sessionId: 'session_direct',
      attachments: undefined,
      conversation: undefined,
      streamExecution,
      capturePendingInteraction,
      emitMessage,
      emitError,
    })

    expect(streamExecution).toHaveBeenCalledWith('Run this', 'session_direct', undefined, undefined)
    expect(capturePendingInteraction).toHaveBeenCalledWith(message, {
      runId: 'session_direct',
      providerSessionId: 'session_direct',
    })
    expect(emitMessage).toHaveBeenCalledWith(message)
    expect(emitError).not.toHaveBeenCalled()
  })

  it('emits raw error payload when direct execution throws', async () => {
    const emitError = vi.fn(async () => {})

    await runDirectExecutionStream({
      prompt: 'Run this',
      sessionId: 'session_direct',
      attachments: undefined,
      conversation: undefined,
      streamExecution: vi.fn(async function* () {
        throw new Error('boom')
      }),
      capturePendingInteraction: vi.fn(),
      emitMessage: vi.fn(async () => {}),
      emitError,
    })

    expect(emitError).toHaveBeenCalledWith('boom')
  })
})
