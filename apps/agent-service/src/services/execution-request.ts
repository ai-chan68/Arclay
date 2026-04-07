import type { MessageAttachment } from '@shared-types'
import {
  prepareExecutionStart,
  type PrepareExecutionStartInput,
  type PrepareExecutionStartResult,
} from './execution-start'
import type { AgentRun, AgentRunPhase } from './agent-run-store'

export interface PrepareExecutionRequestInput {
  body: Record<string, unknown>
  defaultWorkDir: string
  createRun: (phase: AgentRunPhase, preferredId?: string) => AgentRun
  deleteRun: (runId: string) => void
  executionStartDeps: Omit<
    PrepareExecutionStartInput,
    | 'planId'
    | 'prompt'
    | 'runId'
    | 'requestedTaskId'
    | 'requestedTurnId'
    | 'requestedReadVersion'
    | 'requestedWorkDir'
    | 'defaultWorkDir'
  >
  prepareExecutionStartFn?: (
    input: PrepareExecutionStartInput
  ) => Promise<PrepareExecutionStartResult>
}

export type PrepareExecutionRequestResult =
  | {
      status: 'validation_error'
      statusCode: 400
      body: { error: string }
    }
  | {
      status: 'response'
      statusCode: 404 | 409
      body: Record<string, unknown>
    }
  | ({
      status: 'ready'
      run: AgentRun
      promptText: string
      attachments?: MessageAttachment[]
    } & Extract<PrepareExecutionStartResult, { status: 'ready' }>)

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined
}

function normalizeOptionalReadVersion(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(0, Math.floor(value))
}

export async function prepareExecutionRequest(
  input: PrepareExecutionRequestInput
): Promise<PrepareExecutionRequestResult> {
  const planId = normalizeOptionalString(input.body.planId)
  if (!planId) {
    return {
      status: 'validation_error',
      statusCode: 400,
      body: { error: 'planId is required' },
    }
  }

  const promptText = typeof input.body.prompt === 'string'
    ? input.body.prompt
    : ''
  const requestedWorkDir = normalizeOptionalString(input.body.workDir)
  const requestedTaskId = normalizeOptionalString(input.body.taskId)
  const requestedTurnId = normalizeOptionalString(input.body.turnId)
  const requestedReadVersion = normalizeOptionalReadVersion(input.body.readVersion)
  const preferredSessionId = normalizeOptionalString(input.body.sessionId)
  const attachments = Array.isArray(input.body.attachments)
    ? input.body.attachments as MessageAttachment[]
    : undefined

  const run = input.createRun('execute', preferredSessionId)
  const prepareExecutionStartFn = input.prepareExecutionStartFn || prepareExecutionStart
  const executionStartResult = await prepareExecutionStartFn({
    ...input.executionStartDeps,
    planId,
    prompt: promptText,
    runId: run.id,
    requestedTaskId,
    requestedTurnId,
    requestedReadVersion,
    requestedWorkDir,
    defaultWorkDir: input.defaultWorkDir,
  })

  if (executionStartResult.status === 'not_found') {
    input.deleteRun(run.id)
    return {
      status: 'response',
      statusCode: 404,
      body: {
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND',
      },
    }
  }

  if (executionStartResult.status === 'plan_conflict') {
    input.deleteRun(run.id)
    return {
      status: 'response',
      statusCode: 409,
      body: {
        error: 'Plan is not executable',
        code: 'PLAN_STATE_CONFLICT',
        planStatus: executionStartResult.planStatus,
      },
    }
  }

  if (executionStartResult.status === 'turn_conflict') {
    input.deleteRun(run.id)
    return {
      status: 'response',
      statusCode: 409,
      body: {
        error: executionStartResult.error,
        code: executionStartResult.code,
        turnState: executionStartResult.turnState,
        taskVersion: executionStartResult.taskVersion,
      },
    }
  }

  return {
    ...executionStartResult,
    run,
    promptText,
    attachments,
  }
}
