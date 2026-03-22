import type { AgentMessage } from '@shared-types'
import type { ExecutionCompletionSummary } from './execution-completion'
import type { ExecutionObservation, RuntimeGateResult } from './execution-runtime-gate'

export interface HandleExecutionAttemptMessageResult {
  executionFailed: boolean
  executionFailureReason: string | null
  shouldForward: boolean
}

export interface RunExecutionAttemptLoopInput {
  executionPrompt: string
  executionWorkspaceDir: string
  effectiveWorkDir: string
  progressPath: string
  runId: string
  executionSummary: ExecutionCompletionSummary
  runtimeGateRequired: boolean
  maxExecutionAttempts: number
  createObservation: () => ExecutionObservation
  collectObservation: (message: AgentMessage, observation: ExecutionObservation) => void
  evaluateRuntimeGate: (observation: ExecutionObservation, workDir: string) => Promise<RuntimeGateResult>
  streamExecution: (promptForAttempt: string) => AsyncIterable<AgentMessage>
  isAborted: () => boolean
  handleMessage: (
    message: AgentMessage,
    observation: ExecutionObservation
  ) => Promise<HandleExecutionAttemptMessageResult>
  emitMessage: (message: AgentMessage) => Promise<void>
  appendProgressEntry: (progressPath: string, lines: string[]) => Promise<void>
  createId: (prefix: string) => string
  now?: () => Date
  buildRuntimeRepairPrompt?: (executionPrompt: string, gate: RuntimeGateResult, workDir: string) => string
}

export interface RunExecutionAttemptLoopResult {
  abortedByUser: boolean
  executionFailed: boolean
  executionFailureReason: string
  runtimeGatePassed: boolean
  runtimeGateResult: RuntimeGateResult | null
}

function createRuntimeAutoRepairMessage(
  attempt: number,
  reason: string,
  createId: (prefix: string) => string,
  now: Date
): AgentMessage {
  return {
    id: createId('msg'),
    type: 'text',
    role: 'assistant',
    content: `运行校验未通过，开始自动修复（第 ${attempt} 次尝试）：${reason}`,
    timestamp: now.getTime(),
  }
}

function createRuntimePassedMessage(
  previewUrl: string | null,
  createId: (prefix: string) => string,
  now: Date
): AgentMessage {
  return {
    id: createId('msg'),
    type: 'result',
    role: 'assistant',
    content: previewUrl ? `运行验证通过，前端预览地址：${previewUrl}` : '运行验证通过。',
    timestamp: now.getTime(),
  }
}

function createRuntimeFailedMessage(
  reason: string,
  createId: (prefix: string) => string,
  now: Date
): AgentMessage {
  return {
    id: createId('msg'),
    type: 'error',
    errorMessage: reason,
    timestamp: now.getTime(),
  }
}

export async function runExecutionAttemptLoop(
  input: RunExecutionAttemptLoopInput
): Promise<RunExecutionAttemptLoopResult> {
  const now = input.now || (() => new Date())
  const buildRepairPrompt = input.buildRuntimeRepairPrompt
    || ((executionPrompt, gate) => executionPrompt)

  let abortedByUser = false
  let executionFailed = false
  let executionFailureReason = ''
  let runtimeGatePassed = !input.runtimeGateRequired
  let runtimeGateResult: RuntimeGateResult | null = null

  for (let attempt = 0; attempt < input.maxExecutionAttempts; attempt += 1) {
    const observation = input.createObservation()
    const isRepairAttempt = attempt > 0
    const promptForAttempt = isRepairAttempt && runtimeGateResult
      ? buildRepairPrompt(input.executionPrompt, runtimeGateResult, input.executionWorkspaceDir)
      : input.executionPrompt

    if (isRepairAttempt && runtimeGateResult) {
      const timestamp = now()
      await input.emitMessage(
        createRuntimeAutoRepairMessage(attempt + 1, runtimeGateResult.reason, input.createId, timestamp)
      )
      await input.appendProgressEntry(input.progressPath, [
        `### Runtime Auto Repair (${timestamp.toISOString()})`,
        `- Attempt: ${attempt + 1}/${input.maxExecutionAttempts}`,
        `- Reason: ${runtimeGateResult.reason}`,
      ])
    }

    let attemptFailed = false
    for await (const message of input.streamExecution(promptForAttempt)) {
      if (input.isAborted()) {
        abortedByUser = true
        break
      }

      input.collectObservation(message, observation)
      const processingResult = await input.handleMessage(message, observation)
      if (processingResult.executionFailed) {
        executionFailed = true
        executionFailureReason = processingResult.executionFailureReason || 'Execution failed before completion.'
        attemptFailed = true
      }

      if (!processingResult.shouldForward) {
        continue
      }

      await input.emitMessage(message)
    }

    if (abortedByUser || executionFailed || attemptFailed) {
      break
    }

    if (!input.runtimeGateRequired) {
      runtimeGatePassed = true
      break
    }

    runtimeGateResult = await input.evaluateRuntimeGate(observation, input.effectiveWorkDir)
    if (runtimeGateResult.passed) {
      runtimeGatePassed = true
      const timestamp = now()
      await input.appendProgressEntry(input.progressPath, [
        `### Runtime Verification (${timestamp.toISOString()})`,
        '- Status: passed',
        `- Healthy URLs: ${runtimeGateResult.healthyUrls.join(', ') || '(none)'}`,
      ])
      input.executionSummary.resultMessageCount += 1
      await input.emitMessage(
        createRuntimePassedMessage(runtimeGateResult.previewUrl, input.createId, timestamp)
      )
      break
    }

    if (attempt < input.maxExecutionAttempts - 1) {
      continue
    }

    executionFailed = true
    executionFailureReason = `Runtime verification failed: ${runtimeGateResult.reason}`
    const timestamp = now()
    await input.appendProgressEntry(input.progressPath, [
      `### Runtime Verification (${timestamp.toISOString()})`,
      '- Status: failed',
      `- Reason: ${runtimeGateResult.reason}`,
      `- Checked URLs: ${runtimeGateResult.checkedUrls.join(', ') || '(none)'}`,
      `- Healthy URLs: ${runtimeGateResult.healthyUrls.join(', ') || '(none)'}`,
    ])
    await input.emitMessage(
      createRuntimeFailedMessage(executionFailureReason, input.createId, timestamp)
    )
  }

  return {
    abortedByUser,
    executionFailed,
    executionFailureReason,
    runtimeGatePassed,
    runtimeGateResult,
  }
}
