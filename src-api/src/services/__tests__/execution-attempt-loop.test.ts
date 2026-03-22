import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { ExecutionCompletionSummary } from '../execution-completion'
import type { ExecutionObservation, RuntimeGateResult } from '../execution-runtime-gate'
import { runExecutionAttemptLoop } from '../execution-attempt-loop'

function createSummary(
  overrides: Partial<ExecutionCompletionSummary> = {}
): ExecutionCompletionSummary {
  return {
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
    providerStopReason: null,
    ...overrides,
  }
}

function createObservation(): ExecutionObservation {
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

describe('runExecutionAttemptLoop', () => {
  it('streams a single attempt without runtime gate and preserves forwarded messages', async () => {
    const executionSummary = createSummary()
    const emitted: AgentMessage[] = []

    const result = await runExecutionAttemptLoop({
      executionPrompt: 'Execute the plan',
      executionWorkspaceDir: '/tmp/workspace',
      effectiveWorkDir: '/tmp/workspace',
      progressPath: '/tmp/workspace/progress.md',
      runId: 'run_single_attempt',
      executionSummary,
      runtimeGateRequired: false,
      maxExecutionAttempts: 1,
      createObservation,
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn(),
      streamExecution: () => (async function* () {
        yield {
          id: 'text_single_attempt',
          type: 'text',
          role: 'assistant',
          content: 'running...',
          timestamp: 1,
        } as AgentMessage
        yield {
          id: 'done_single_attempt',
          type: 'done',
          timestamp: 2,
        } as AgentMessage
      })(),
      isAborted: () => false,
      handleMessage: async (message) => ({
        executionFailed: false,
        executionFailureReason: null,
        shouldForward: message.type !== 'done',
      }),
      emitMessage: async (message) => {
        emitted.push(message)
      },
      appendProgressEntry: vi.fn(async () => {}),
      createId: () => 'unused',
      now: () => new Date('2026-03-22T00:10:00.000Z'),
    })

    expect(result.abortedByUser).toBe(false)
    expect(result.executionFailed).toBe(false)
    expect(result.runtimeGatePassed).toBe(true)
    expect(result.runtimeGateResult).toBeNull()
    expect(emitted.map((message) => message.type)).toEqual(['text'])
  })

  it('auto-retries after runtime gate failure and emits a final runtime error on the last failed attempt', async () => {
    const executionSummary = createSummary()
    const emitted: AgentMessage[] = []
    const appendProgressEntry = vi.fn(async () => {})
    let streamCalls = 0
    const failedGate: RuntimeGateResult = {
      passed: false,
      reason: 'Frontend server did not pass health check after execution.',
      checkedUrls: ['http://127.0.0.1:5173'],
      healthyUrls: [],
      previewUrl: null,
      frontendExpected: true,
      frontendHealthy: false,
      backendExpected: false,
      backendHealthy: false,
    }

    const result = await runExecutionAttemptLoop({
      executionPrompt: 'Run the frontend',
      executionWorkspaceDir: '/tmp/workspace',
      effectiveWorkDir: '/tmp/workspace',
      progressPath: '/tmp/workspace/progress.md',
      runId: 'run_retry_fail',
      executionSummary,
      runtimeGateRequired: true,
      maxExecutionAttempts: 2,
      createObservation,
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi
        .fn<(_: ExecutionObservation, __: string) => Promise<RuntimeGateResult>>()
        .mockResolvedValue(failedGate),
      streamExecution: () => (async function* () {
        streamCalls += 1
        yield {
          id: `done_retry_${streamCalls}`,
          type: 'done',
          timestamp: streamCalls,
        } as AgentMessage
      })(),
      isAborted: () => false,
      handleMessage: async (message) => ({
        executionFailed: false,
        executionFailureReason: null,
        shouldForward: message.type !== 'done',
      }),
      emitMessage: async (message) => {
        emitted.push(message)
      },
      appendProgressEntry,
      createId: vi
        .fn<(prefix: string) => string>()
        .mockImplementation((prefix) => `${prefix}_retry_fail`),
      now: () => new Date('2026-03-22T00:11:00.000Z'),
    })

    expect(streamCalls).toBe(2)
    expect(result.executionFailed).toBe(true)
    expect(result.executionFailureReason).toBe('Runtime verification failed: Frontend server did not pass health check after execution.')
    expect(result.runtimeGatePassed).toBe(false)
    expect(emitted.map((message) => message.type)).toEqual(['text', 'error'])
    expect(String(emitted[0]?.content || '')).toContain('开始自动修复')
    expect(String(emitted[1]?.errorMessage || '')).toContain('Runtime verification failed')
    expect(appendProgressEntry).toHaveBeenCalledWith('/tmp/workspace/progress.md', [
      '### Runtime Auto Repair (2026-03-22T00:11:00.000Z)',
      '- Attempt: 2/2',
      '- Reason: Frontend server did not pass health check after execution.',
    ])
  })

  it('emits a runtime verification result message when the gate passes', async () => {
    const executionSummary = createSummary()
    const emitted: AgentMessage[] = []
    const passedGate: RuntimeGateResult = {
      passed: true,
      reason: 'Runtime verification passed.',
      checkedUrls: ['http://127.0.0.1:5173'],
      healthyUrls: ['http://127.0.0.1:5173'],
      previewUrl: 'http://127.0.0.1:5173',
      frontendExpected: true,
      frontendHealthy: true,
      backendExpected: false,
      backendHealthy: false,
    }

    const result = await runExecutionAttemptLoop({
      executionPrompt: 'Run the frontend',
      executionWorkspaceDir: '/tmp/workspace',
      effectiveWorkDir: '/tmp/workspace',
      progressPath: '/tmp/workspace/progress.md',
      runId: 'run_gate_pass',
      executionSummary,
      runtimeGateRequired: true,
      maxExecutionAttempts: 2,
      createObservation,
      collectObservation: vi.fn(),
      evaluateRuntimeGate: vi.fn().mockResolvedValue(passedGate),
      streamExecution: () => (async function* () {
        yield {
          id: 'done_gate_pass',
          type: 'done',
          timestamp: 1,
        } as AgentMessage
      })(),
      isAborted: () => false,
      handleMessage: async (message) => ({
        executionFailed: false,
        executionFailureReason: null,
        shouldForward: message.type !== 'done',
      }),
      emitMessage: async (message) => {
        emitted.push(message)
      },
      appendProgressEntry: vi.fn(async () => {}),
      createId: () => 'msg_runtime_gate_pass',
      now: () => new Date('2026-03-22T00:12:00.000Z'),
    })

    expect(result.executionFailed).toBe(false)
    expect(result.runtimeGatePassed).toBe(true)
    expect(executionSummary.resultMessageCount).toBe(1)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.type).toBe('result')
    expect(String(emitted[0]?.content || '')).toContain('http://127.0.0.1:5173')
  })
})
