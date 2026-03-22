import type { AgentRun, AgentRunStopResult } from './agent-run-store'
import type { TaskPlan } from '../types/agent-new'
import type { TurnArtifactRecord, TaskRuntimeRecord, TurnRecord } from '../types/turn-runtime'
import type { PlanRecord } from '../types/plan-store'

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined
}

export function resolveStopSessionRequest(input: {
  sessionId?: string
  stopAgentSession: (sessionId: string) => AgentRunStopResult
}): {
  statusCode: 200 | 404
  body: Record<string, unknown>
} {
  const result = input.stopAgentSession(input.sessionId || '')
  if (result.status === 'stopped') {
    return {
      statusCode: 200,
      body: { success: true },
    }
  }

  return {
    statusCode: 404,
    body: {
      success: false,
      error: 'Session not found',
    },
  }
}

export function resolveRunStatusRequest(input: {
  sessionId?: string
  getRun: (sessionId: string) => AgentRun | null
}): {
  statusCode: 200 | 404
  body: Record<string, unknown>
} {
  const run = input.getRun(input.sessionId || '')
  if (!run) {
    return {
      statusCode: 404,
      body: { error: 'Session not found' },
    }
  }

  return {
    statusCode: 200,
    body: {
      id: run.id,
      phase: run.phase,
      isAborted: run.isAborted,
      createdAt: run.createdAt,
    },
  }
}

export function resolvePlanLookupRequest(input: {
  planId?: string
  getPlan: (planId: string) => TaskPlan | null
}): {
  statusCode: 200 | 404
  body: Record<string, unknown> | TaskPlan
} {
  const plan = input.getPlan(input.planId || '')
  if (!plan) {
    return {
      statusCode: 404,
      body: { error: 'Plan not found' },
    }
  }

  return {
    statusCode: 200,
    body: plan,
  }
}

export function resolveTaskRuntimeRequest(input: {
  taskId?: string
  getRuntime: (taskId: string) => TaskRuntimeRecord | null
  listTurns: (taskId: string) => TurnRecord[]
  listArtifacts: (taskId: string) => TurnArtifactRecord[]
}): {
  statusCode: 200 | 400
  body: Record<string, unknown>
} {
  const taskId = normalizeOptionalString(input.taskId)
  if (!taskId) {
    return {
      statusCode: 400,
      body: { error: 'taskId is required' },
    }
  }

  return {
    statusCode: 200,
    body: {
      taskId,
      runtime: input.getRuntime(taskId),
      turns: input.listTurns(taskId),
      artifacts: input.listArtifacts(taskId),
    },
  }
}

export function resolveTurnLookupRequest(input: {
  turnId?: string
  getTurn: (turnId: string) => TurnRecord | null
  getRuntime: (taskId: string) => TaskRuntimeRecord | null
}): {
  statusCode: 200 | 400 | 404
  body: Record<string, unknown>
} {
  const turnId = normalizeOptionalString(input.turnId)
  if (!turnId) {
    return {
      statusCode: 400,
      body: { error: 'turnId is required' },
    }
  }

  const turn = input.getTurn(turnId)
  if (!turn) {
    return {
      statusCode: 404,
      body: { error: 'Turn not found' },
    }
  }

  return {
    statusCode: 200,
    body: {
      turn,
      runtime: input.getRuntime(turn.taskId),
    },
  }
}

export function resolvePlanRejectRequest(input: {
  body: Record<string, unknown>
  rejectPendingPlan: (
    planId: string,
    reason?: string
  ) => { status: 'not_found' } | { status: 'rejected'; record: PlanRecord }
}): {
  statusCode: 200 | 400 | 404
  body: Record<string, unknown>
} {
  const planId = normalizeOptionalString(input.body.planId)
  if (!planId) {
    return {
      statusCode: 400,
      body: { error: 'planId is required' },
    }
  }

  const reason = normalizeOptionalString(input.body.reason)
  const result = input.rejectPendingPlan(planId, reason)
  if (result.status === 'not_found') {
    return {
      statusCode: 404,
      body: {
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND',
      },
    }
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      planId,
      planStatus: result.record.status,
    },
  }
}
