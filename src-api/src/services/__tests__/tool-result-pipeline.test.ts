import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import { buildTurnDetailSnapshot } from '../turn-detail-builder'
import { ProcessExecutionStreamMessageInput, processExecutionStreamMessage } from '../execution-stream-processing'

describe('tool result pipeline contract', () => {
  it('supports structured toolResult metadata in AgentMessage', () => {
    const message: AgentMessage = {
      id: 'msg_tool_result',
      type: 'tool_result',
      toolUseId: 'tool_use_1',
      toolOutput: '{"status":"success","artifacts":["/tmp/test.md"],"summary":"Created test.md"}',
      toolSummary: 'Created test.md',
      artifacts: ['/tmp/test.md'],
      timestamp: Date.now(),
    }

    expect(message.toolSummary).toBe('Created test.md')
    expect(message.artifacts).toContain('/tmp/test.md')
  })

  it('turn-detail-builder should prefer structured artifacts over parsing JSON string', () => {
    const messages: AgentMessage[] = [
      {
        id: 'msg_1',
        type: 'tool_use',
        toolName: 'write',
        toolUseId: 'u1',
        toolInput: { file_path: '/real/path.ts' },
        timestamp: Date.now()
      },
      {
        id: 'msg_2',
        type: 'tool_result',
        toolUseId: 'u1',
        toolOutput: 'old output',
        artifacts: ['/metadata/path.ts'], // Priority
        timestamp: Date.now()
      }
    ]

    const snapshot = buildTurnDetailSnapshot({
      taskId: 't1',
      turn: { id: 'turn1', prompt: 'test', status: 'completed', createdAt: Date.now(), updatedAt: Date.now() } as any,
      messages
    })

    // Should find the artifact from the metadata even if toolOutput is not JSON
    expect(snapshot.artifacts.some(a => a.path === '/metadata/path.ts')).toBe(true)
  })

  it('execution-stream-processing should prefer toolSummary for audit logs', async () => {
    const summary = {
      toolUseCount: 0,
      toolResultCount: 0,
      meaningfulToolUseCount: 0,
      browserToolUseCount: 0,
      browserNavigationCount: 0,
      browserInteractionCount: 0,
      browserSnapshotCount: 0,
      browserScreenshotCount: 0,
      browserEvalCount: 0,
      assistantTextCount: 0,
      meaningfulAssistantTextCount: 0,
      preambleAssistantTextCount: 0,
      resultMessageCount: 0,
      latestTodoSnapshot: null,
      pendingInteractionCount: 0,
      blockerCandidate: null,
      blockedArtifactPath: null,
      providerResultSubtype: null,
      providerStopReason: null
    }

    const appendProgressEntry = vi.fn()
    const message: AgentMessage = {
      id: 'm1',
      type: 'tool_result',
      toolUseId: 'u1',
      toolOutput: 'raw output',
      toolSummary: 'Concise Summary',
      timestamp: Date.now()
    }

    await processExecutionStreamMessage({
      message,
      executionSummary: summary,
      browserAutomationIntent: false,
      progressPath: 'p1',
      appendProgressEntry,
      now: new Date()
    })

    // The audit entry should use the summary
    const auditCall = appendProgressEntry.mock.calls.find(call =>
      call[1].some((line: string) => line.includes('Concise Summary'))
    )
    expect(auditCall).toBeDefined()
  })
})
