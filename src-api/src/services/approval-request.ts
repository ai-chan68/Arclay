import type { ApprovalCoordinatorResolveResult, ApprovalRequestKind, ApprovalRequestRecord } from '../types/approval'
import type { PendingQuestion } from '../types/agent-new'
import type { TurnRecord } from '../types/turn-runtime'
import { resolvePermissionResponse, resolveQuestionResponse } from './approval-response'
import {
  buildApprovalDiagnosticsResponse,
  buildPendingApprovalsResponse,
  normalizeApprovalDiagnosticsLimit,
} from './approval-recovery'

type PendingScope = {
  taskId?: string
  runId?: string
  kind?: ApprovalRequestKind
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined
}

function normalizeAnswers(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === 'string')
  ) as Record<string, string>
}

function resolvePendingScope(input: {
  taskId?: string
  runId?: string
  sessionId?: string
  kind?: ApprovalRequestKind
}): PendingScope {
  return {
    taskId: normalizeOptionalString(input.taskId),
    runId: normalizeOptionalString(input.runId) || normalizeOptionalString(input.sessionId),
    kind: input.kind,
  }
}

export function resolvePendingApprovalsRequest(input: {
  taskId?: string
  runId?: string
  sessionId?: string
  kind?: ApprovalRequestKind
  listPending: (scope: PendingScope) => ApprovalRequestRecord[]
  getLatestTerminal: (scope: PendingScope) => ApprovalRequestRecord | null
}) {
  const scope = resolvePendingScope(input)
  const pendingItems = input.listPending(scope)
  const latestTerminal = input.getLatestTerminal(scope)

  return buildPendingApprovalsResponse({
    pendingItems,
    latestTerminal,
  })
}

export function resolveApprovalDiagnosticsRequest(input: {
  taskId?: string
  runId?: string
  sessionId?: string
  kind?: ApprovalRequestKind
  limit?: string
  getDiagnostics: (
    scope: PendingScope,
    limit: number
  ) => {
    scopedCount: number
    countsByStatus: Record<string, number>
    countsByKind: Record<string, number>
    pending: ApprovalRequestRecord[]
    terminal: ApprovalRequestRecord[]
  }
}) {
  const scope = resolvePendingScope(input)
  const safeLimit = normalizeApprovalDiagnosticsLimit(input.limit)
  const diagnostics = input.getDiagnostics(scope, safeLimit)

  return buildApprovalDiagnosticsResponse({
    taskId: scope.taskId,
    runId: scope.runId,
    kind: scope.kind,
    limit: safeLimit,
    diagnostics: diagnostics as any,
  })
}

export function resolvePermissionRequest(input: {
  body: Record<string, unknown>
  resolvePermission: (
    permissionId: string,
    approved: boolean,
    reason?: string
  ) => ApprovalCoordinatorResolveResult
  addToolToAutoAllowList: (toolName: string) => { updated: boolean; tools: string[] }
  findLatestTurnByTask: (
    taskId: string,
    states: TurnRecord['state'][]
  ) => { id: string } | null
}): {
  statusCode: 200 | 400 | 404
  body: Record<string, unknown>
} {
  const permissionId = normalizeOptionalString(input.body.permissionId)
  if (!permissionId) {
    return {
      statusCode: 400,
      body: { error: 'permissionId is required' },
    }
  }

  if (typeof input.body.approved !== 'boolean') {
    return {
      statusCode: 400,
      body: { error: 'approved must be boolean' },
    }
  }

  const approved = input.body.approved
  const reason = normalizeOptionalString(input.body.reason)
  const addToAutoAllow = input.body.addToAutoAllow === true
  const resolution = input.resolvePermission(permissionId, approved, reason)
  if (resolution.status === 'not_found') {
    return {
      statusCode: 404,
      body: { error: 'Permission request not found' },
    }
  }

  let autoAllowUpdated = false
  let autoAllowToolName: string | null = null
  if (approved && addToAutoAllow) {
    const metadata = resolution.record?.permission?.metadata as Record<string, unknown> | undefined
    const toolName = typeof metadata?.toolName === 'string' ? metadata.toolName.trim() : ''
    if (toolName) {
      const updateResult = input.addToolToAutoAllowList(toolName)
      autoAllowUpdated = updateResult.updated
      autoAllowToolName = toolName
    }
  }

  return {
    statusCode: 200,
    body: resolvePermissionResponse({
      resolution,
      approved,
      autoAllowUpdated,
      autoAllowToolName,
      findLatestTurnByTask: input.findLatestTurnByTask,
    }),
  }
}

export function resolveQuestionRequest(input: {
  body: Record<string, unknown>
  resolveQuestion: (
    questionId: string,
    answers: Record<string, string>
  ) => ApprovalCoordinatorResolveResult
  findLatestTurnByTask: (
    taskId: string,
    states: TurnRecord['state'][]
  ) => { id: string } | null
}): {
  statusCode: 200 | 400 | 404
  body: Record<string, unknown>
} {
  const questionId = normalizeOptionalString(input.body.questionId)
  if (!questionId) {
    return {
      statusCode: 400,
      body: { error: 'questionId is required' },
    }
  }

  const answers = normalizeAnswers(input.body.answers)
  if (!answers) {
    return {
      statusCode: 400,
      body: { error: 'answers must be an object' },
    }
  }

  const resolution = input.resolveQuestion(questionId, answers)
  if (resolution.status === 'not_found') {
    return {
      statusCode: 404,
      body: { error: 'Question not found' },
    }
  }

  return {
    statusCode: 200,
    body: resolveQuestionResponse({
      resolution,
      answers,
      findLatestTurnByTask: input.findLatestTurnByTask,
    }),
  }
}
