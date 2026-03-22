import type { ConversationMessage } from '../core/agent/interface'
import type { AgentRun, AgentRunPhase } from './agent-run-store'
import type { TurnRecord } from '../types/turn-runtime'

const DEFAULT_MAX_CLARIFICATION_ROUNDS = 3
const MAX_CLARIFICATION_ROUNDS_LIMIT = 10

function normalizeMaxClarificationRounds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_CLARIFICATION_ROUNDS
  }
  const normalized = Math.floor(value)
  if (normalized <= 0) {
    return DEFAULT_MAX_CLARIFICATION_ROUNDS
  }
  return Math.min(normalized, MAX_CLARIFICATION_ROUNDS_LIMIT)
}

function buildPromptWithClarificationAnswers(
  prompt: string,
  clarificationAnswers?: Record<string, string>
): string {
  if (!clarificationAnswers || typeof clarificationAnswers !== 'object') {
    return prompt
  }

  const entries = Object.entries(clarificationAnswers)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
    .filter(([, value]) => value.length > 0)

  if (entries.length === 0) {
    return prompt
  }

  const lines = entries.map(([key, value]) => `${key}: ${value}`).join('\n')
  return `${prompt}\n\n[Clarification Answers]\n${lines}`
}

function normalizeDependsOnTurnIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeConversationHistory(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return []

  const normalized = raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const record = item as Record<string, unknown>
      const roleRaw = typeof record.role === 'string' ? record.role.trim().toLowerCase() : ''
      const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system'
        ? roleRaw
        : ''
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (!role || !content) {
        return null
      }
      return {
        role: role as ConversationMessage['role'],
        content,
      } satisfies ConversationMessage
    })
    .filter((item): item is ConversationMessage => !!item)

  const maxHistoryMessages = 24
  return normalized.length <= maxHistoryMessages
    ? normalized
    : normalized.slice(-maxHistoryMessages)
}

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

export type PreparePlanningRequestResult =
  | {
      status: 'validation_error'
      statusCode: 400
      body: { error: string }
    }
  | {
      status: 'ready'
      run: AgentRun
      rawPrompt: string
      planningPrompt: string
      taskId?: string
      maxClarificationRounds: number
      conversation: ConversationMessage[]
      activeTurn: TurnRecord | null
    }

export function preparePlanningRequest(input: {
  body: Record<string, unknown>
  createRun: (phase: AgentRunPhase, preferredId?: string) => AgentRun
  createTurn: (input: {
    taskId: string
    prompt: string
    runId: string
    turnId?: string
    readVersion?: number
    dependsOnTurnIds: string[]
  }) => { turn: TurnRecord | null }
}): PreparePlanningRequestResult {
  const rawPrompt = typeof input.body.prompt === 'string'
    ? input.body.prompt
    : ''
  if (!rawPrompt) {
    return {
      status: 'validation_error',
      statusCode: 400,
      body: { error: 'prompt is required' },
    }
  }

  const run = input.createRun('plan')
  const planningPrompt = buildPromptWithClarificationAnswers(
    rawPrompt,
    input.body.clarificationAnswers as Record<string, string> | undefined
  )
  const taskId = normalizeOptionalString(input.body.taskId)
  const turnId = normalizeOptionalString(input.body.turnId)
  const readVersion = normalizeOptionalReadVersion(input.body.readVersion)
  const dependsOnTurnIds = normalizeDependsOnTurnIds(input.body.dependsOnTurnIds)
  const conversation = normalizeConversationHistory(input.body.conversation)

  let activeTurn: TurnRecord | null = null
  if (taskId) {
    activeTurn = input.createTurn({
      taskId,
      prompt: planningPrompt,
      runId: run.id,
      turnId,
      readVersion,
      dependsOnTurnIds,
    }).turn
  }

  return {
    status: 'ready',
    run,
    rawPrompt,
    planningPrompt,
    taskId,
    maxClarificationRounds: normalizeMaxClarificationRounds(input.body.maxClarificationRounds),
    conversation,
    activeTurn,
  }
}
