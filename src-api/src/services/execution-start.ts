import path from 'path'
import type { TaskPlan } from '../types/agent-new'
import type { ApprovalListFilter } from '../types/approval'
import type { PlanFailReason, PlanRecord } from '../types/plan-store'
import type {
  ExecutionStartResult,
  TaskRuntimeRecord,
  TurnRecord,
} from '../types/turn-runtime'
import type { PlanningFilesBootstrapResult } from './planning-files'

export interface PrepareExecutionStartInput {
  planId: string
  prompt: string
  runId: string
  requestedTaskId?: string
  requestedTurnId?: string
  requestedReadVersion?: number
  requestedWorkDir?: string
  defaultWorkDir: string
  getPlanRecord: (planId: string) => PlanRecord | null
  getTurn: (turnId: string) => TurnRecord | null
  findLatestTurnByTask: (taskId: string, states: TurnRecord['state'][]) => TurnRecord | null
  startPlanExecution: (
    planId: string,
    context: { taskId?: string; runId?: string; turnId?: string }
  ) => { status: 'ok'; record: PlanRecord; plan: TaskPlan } | { status: 'not_found' } | { status: 'conflict'; record: PlanRecord }
  cancelExpiredPlanTurns: (records: PlanRecord[]) => number
  startTurnExecution: (turnId: string, expectedTaskVersion?: number) => ExecutionStartResult
  markPlanOrphaned: (
    planId: string,
    reason: string,
    failReason: Exclude<PlanFailReason, null>
  ) => void
  orphanPendingApprovals?: (
    scope: Omit<ApprovalListFilter, 'status'>,
    reason: string
  ) => number
  bootstrapPlanningFiles: (input: {
    workDir: string
    taskId: string
    goal: string
    steps: string[]
    notes?: string
    originalPrompt?: string
  }) => Promise<PlanningFilesBootstrapResult>
}

export type PrepareExecutionStartResult =
  | { status: 'not_found' }
  | {
      status: 'plan_conflict'
      planStatus: PlanRecord['status']
    }
  | {
      status: 'turn_conflict'
      error: string
      code: string
      turnState: TurnRecord['state'] | null
      taskVersion: number | null
    }
  | {
      status: 'ready'
      plan: TaskPlan
      activeTurn: TurnRecord | null
      effectiveTaskId: string | undefined
      executionTaskId: string
      effectiveWorkDir: string
      executionWorkspaceDir: string
      progressFilePath: string
      planningFilesBootstrap: PlanningFilesBootstrapResult
    }

function resolveEffectiveTurn(
  requestedTurnId: string | undefined,
  effectiveTaskId: string | undefined,
  getTurn: PrepareExecutionStartInput['getTurn'],
  findLatestTurnByTask: PrepareExecutionStartInput['findLatestTurnByTask']
): TurnRecord | null {
  if (requestedTurnId) {
    const boundTurn = getTurn(requestedTurnId)
    if (boundTurn && (!effectiveTaskId || boundTurn.taskId === effectiveTaskId)) {
      return boundTurn
    }
    return null
  }

  if (!effectiveTaskId) {
    return null
  }

  return findLatestTurnByTask(effectiveTaskId, ['awaiting_approval', 'executing'])
}

function resolveTurnConflictFailReason(code?: string | null): Exclude<PlanFailReason, null> {
  return code === 'TURN_VERSION_CONFLICT' ? 'version_conflict' : 'execution_error'
}

function resolveTaskVersion(runtime?: TaskRuntimeRecord | null): number | null {
  return runtime?.version ?? null
}

function hasApprovalScope(scope: Omit<ApprovalListFilter, 'status'>): boolean {
  return Boolean(scope.taskId || scope.runId || scope.providerSessionId)
}

export async function prepareExecutionStart(
  input: PrepareExecutionStartInput
): Promise<PrepareExecutionStartResult> {
  const existingPlanRecord = input.getPlanRecord(input.planId)
  const effectiveTaskId = input.requestedTaskId || existingPlanRecord?.taskId || undefined
  const resolvedTurnId = input.requestedTurnId || existingPlanRecord?.turnId || undefined
  let activeTurn = resolveEffectiveTurn(
    resolvedTurnId,
    effectiveTaskId,
    input.getTurn,
    input.findLatestTurnByTask
  )

  const startExecutionResult = input.startPlanExecution(input.planId, {
    taskId: effectiveTaskId,
    runId: input.runId,
    turnId: activeTurn?.id,
  })

  if (startExecutionResult.status === 'not_found') {
    return { status: 'not_found' }
  }

  if (startExecutionResult.status === 'conflict') {
    if (startExecutionResult.record.status === 'expired') {
      input.cancelExpiredPlanTurns([startExecutionResult.record])
    }
    return {
      status: 'plan_conflict',
      planStatus: startExecutionResult.record.status,
    }
  }

  const plan = startExecutionResult.plan

  if (activeTurn) {
    const turnStartResult = input.startTurnExecution(
      activeTurn.id,
      input.requestedReadVersion
    )
    if (turnStartResult.status !== 'ok' || !turnStartResult.turn) {
      input.markPlanOrphaned(
        input.planId,
        turnStartResult.reason || 'Turn start conflict during execution.',
        resolveTurnConflictFailReason(turnStartResult.code)
      )
      const approvalScope: Omit<ApprovalListFilter, 'status'> = {
        taskId: effectiveTaskId,
        runId: input.runId,
        providerSessionId: input.runId,
      }
      if (input.orphanPendingApprovals && hasApprovalScope(approvalScope)) {
        input.orphanPendingApprovals(
          approvalScope,
          turnStartResult.reason || 'Turn start conflict during execution.'
        )
      }
      return {
        status: 'turn_conflict',
        error: turnStartResult.reason || 'Turn is not executable',
        code: turnStartResult.code || 'TURN_STATE_CONFLICT',
        turnState: turnStartResult.turn?.state || null,
        taskVersion: resolveTaskVersion(turnStartResult.runtime),
      }
    }
    activeTurn = turnStartResult.turn
  }

  const effectiveWorkDir = input.requestedWorkDir || input.defaultWorkDir || process.cwd()
  const executionTaskId = effectiveTaskId || input.runId
  const planningFilesBootstrap = await input.bootstrapPlanningFiles({
    workDir: effectiveWorkDir,
    taskId: executionTaskId,
    goal: plan.goal,
    steps: plan.steps.map((step) => step.description),
    notes: plan.notes,
    originalPrompt: input.prompt,
  })

  return {
    status: 'ready',
    plan,
    activeTurn,
    effectiveTaskId,
    executionTaskId,
    effectiveWorkDir,
    executionWorkspaceDir: planningFilesBootstrap.sessionDir,
    progressFilePath: path.join(planningFilesBootstrap.sessionDir, 'progress.md'),
    planningFilesBootstrap,
  }
}
