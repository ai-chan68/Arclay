/**
 * Agent API routes - New two-phase execution architecture
 *
 * easywork-style two-phase execution:
 *   Phase 1: POST /agent/plan - Generate plan
 *   Phase 2: POST /agent/execute - Execute approved plan
 *   Direct: POST /agent - Direct execution (compatibility mode)
 *
 * 会话和消息的持久化由前端数据库层 (SQLite/IndexedDB) 负责，
 * 后端仅负责执行和流式返回。
 */

import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import path from 'path'
import type { MessageAttachment } from '@shared-types'
import { AgentService, type AgentServiceConfig } from '../services/agent-service'
import { taskPlanner } from '../services/task-planner'
import { bootstrapPlanningFiles } from '../services/planning-files'
import { approvalCoordinator } from '../services/approval-coordinator'
import { agentRunStore } from '../services/agent-run-store'
import {
  createDoneMessage,
  createErrorMessage,
  createSessionMessage,
  emitSseMessage,
} from '../services/agent-stream-events'
import {
  emitBlockedTurnAndDone,
  emitMessages,
  emitMessagesAndTurnTransition,
  emitMessagesAndDone,
  emitMessagesTurnTransitionAndDone,
  emitTurnTransitionAndDone,
} from '../services/agent-stream-sequences'
import { finalizeExecutionLifecycle } from '../services/execution-lifecycle'
import { runExecutionAttemptLoop } from '../services/execution-attempt-loop'
import { resolveExecutionPostRun } from '../services/execution-post-run'
import {
  buildRuntimeRepairPrompt,
  collectExecutionObservation,
  createExecutionObservation,
  evaluateRuntimeGate,
  type RuntimeGateResult,
} from '../services/execution-runtime-gate'
import { processExecutionStreamMessage } from '../services/execution-stream-processing'
import {
  advancePlanningTurn,
  handleBlockedClarificationLimit,
  handlePreflightClarification,
} from '../services/planning-lifecycle'
import {
  createPlanningStreamState,
  processPlanningStreamMessage,
} from '../services/planning-stream-processing'
import { runPlanningSession } from '../services/planning-session'
import { preparePlanningRequest } from '../services/planning-request'
import { resolveExecutionEntry } from '../services/execution-entry'
import { resolveApprovalDiagnosticsRequest, resolvePendingApprovalsRequest, resolvePermissionRequest, resolveQuestionRequest } from '../services/approval-request'
import {
  addToolToAutoAllowList,
  appendProgressEntry,
  buildAgentServiceUnavailableBody,
  capturePendingInteraction,
  createClarificationTracker,
  createRouteMessageId,
  createTurnStateEmitter,
  detectPreflightClarification,
  formatExecutionCompletionSummary,
  normalizeApprovalKind,
} from '../services/route-support'
import { rejectPendingPlan, stopAgentSession } from '../services/runtime-control'
import { resolvePlanLookupRequest, resolvePlanRejectRequest, resolveRunStatusRequest, resolveStopSessionRequest, resolveTaskRuntimeRequest, resolveTurnLookupRequest } from '../services/runtime-request'
import { runExecutionSession } from '../services/execution-session'
import { prepareExecutionRequest } from '../services/execution-request'
import { prepareDirectExecutionRequest, runDirectExecutionStream } from '../services/direct-execution'
import {
  type ExecutionCompletionSummary,
} from '../services/execution-completion'
import { planStore } from '../services/plan-store'
import { cancelTurnsForExpiredPlans } from '../services/plan-turn-sync'
import { turnRuntimeStore } from '../services/turn-runtime-store'
import {
  getSettings,
  normalizeApprovalSettings,
  saveSettingsToFile,
  setSettings,
} from '../settings-store'
import type { TurnTransitionResult } from '../types/turn-runtime'
let agentService: AgentService | null = null
let agentServiceConfig: AgentServiceConfig | null = null

export function setAgentService(service: AgentService, config: AgentServiceConfig): void {
  agentService = service
  agentServiceConfig = config
}

export function clearAgentService(): void {
  agentService = null
  agentServiceConfig = null
}

export function getAgentService(): AgentService | null {
  return agentService
}

export const agentNewRoutes = new Hono()

/**
 * POST /agent/plan
 * Phase 1: Generate execution plan using LLM
 * Body: {
 *   prompt: string,
 *   sessionId?: string,
 *   taskId?: string,
 *   clarificationAnswers?: Record<string, string>,
 *   maxClarificationRounds?: number
 * }
 * Response: SSE stream of AgentMessage (including plan)
 */
agentNewRoutes.post('/plan', async (c) => {
  if (!agentService || !agentServiceConfig) {
    return c.json(buildAgentServiceUnavailableBody(), 500)
  }

  const body = await c.req.json().catch(() => ({}))
  const request = preparePlanningRequest({
    body,
    createRun: (phase, preferredId) => agentRunStore.createRun(phase, preferredId),
    createTurn: (input) => turnRuntimeStore.createTurn(input),
  })
  if (request.status === 'validation_error') {
    return c.json(request.body, request.statusCode)
  }

  const run = request.run
  const effectiveMaxClarificationRounds = request.maxClarificationRounds
  const planningPrompt = request.planningPrompt
  const normalizedTaskId = request.taskId
  const conversation = request.conversation
  const activeTurn = request.activeTurn

  c.header('Content-Type', 'text/event-stream; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    const agent = agentService!.createAgent()
    const emitTurnState = createTurnStateEmitter({
      stream: s,
      getRuntime: (taskId) => turnRuntimeStore.getRuntime(taskId),
      createId: createRouteMessageId,
    })
    const clarificationTracker = createClarificationTracker({
      taskId: normalizedTaskId,
      runId: run.id,
      list: (scope) => approvalCoordinator.list(scope),
      listPending: (scope) => approvalCoordinator.listPending(scope),
    })
    await runPlanningSession({
      planningPrompt,
      rawPrompt: request.rawPrompt,
      runId: run.id,
      taskId: normalizedTaskId,
      maxClarificationRounds: effectiveMaxClarificationRounds,
      activeTurn,
      streamPlanning: () => agent.plan!(planningPrompt, {
        sessionId: run.id,
        cwd: agentServiceConfig?.workDir,
        conversation,
      }),
      isAborted: () => run.isAborted,
      emitMessage: async (message) => {
        await emitSseMessage(s, message)
      },
      emitMessages: async (input) => {
        await emitMessages(s, input)
      },
      emitTurnState: async (result) => {
        await emitTurnState(result)
      },
      emitBlockedTurnAndDone: async (input) => {
        await emitBlockedTurnAndDone(s, {
          ...input,
          emitTurnState,
        })
      },
      emitMessagesAndDone: async (input) => {
        await emitMessagesAndDone(s, input)
      },
      emitMessagesTurnTransitionAndDone: async (input) => {
        await emitMessagesTurnTransitionAndDone(s, {
          ...input,
          emitTurnState,
        })
      },
      emitMessagesAndTurnTransition: async (input) => {
        await emitMessagesAndTurnTransition(s, {
          ...input,
          emitTurnState,
        })
      },
      emitTurnTransitionAndDone: async (input) => {
        await emitTurnTransitionAndDone(s, {
          ...input,
          emitTurnState,
        })
      },
      deleteRun: (runId) => {
        agentRunStore.deleteRun(runId)
      },
      resolvePlanningEntryInput: {
        hasPendingClarification: clarificationTracker.hasPending,
        getNextClarificationRound: clarificationTracker.getNextRound,
        detectPreflightClarification: (prompt) => detectPreflightClarification(prompt, createRouteMessageId),
        advancePlanningTurn: (entryActiveTurn) => advancePlanningTurn({
          activeTurn: entryActiveTurn,
          markTurnAnalyzing: (turnId) => turnRuntimeStore.markTurnAnalyzing(turnId),
          markTurnPlanning: (turnId) => turnRuntimeStore.markTurnPlanning(turnId),
        }),
        handleBlockedClarificationLimit: (input) => handleBlockedClarificationLimit({
          hasPendingClarification: input.hasPendingClarification,
          nextRound: input.nextRound,
          maxClarificationRounds: input.maxClarificationRounds,
          activeTurn: input.activeTurn,
          failTurn: input.failTurn,
          createMessageId: input.createMessageId,
        }),
        handlePreflightClarification: (input) => handlePreflightClarification({
          preflightClarification: input.preflightClarification,
          nextRound: input.nextRound,
          maxClarificationRounds: input.maxClarificationRounds,
          taskId: input.taskId,
          runId: input.runId,
          activeTurn: input.activeTurn,
          captureQuestionRequest: (question, context) => {
            approvalCoordinator.captureQuestionRequest(question, context)
          },
          markTurnAwaitingClarification: input.markTurnAwaitingClarification,
          failTurn: input.failTurn,
          createMessageId: input.createMessageId,
        }),
        captureQuestionRequest: (question, context) => {
          approvalCoordinator.captureQuestionRequest(question, context)
        },
        markTurnAwaitingClarification: (turnId) => turnRuntimeStore.markTurnAwaitingClarification(turnId),
        failTurn: (turnId, reason) => turnRuntimeStore.failTurn(turnId, reason),
        createId: createRouteMessageId,
      },
      planningLoopInput: {
        initialPlanningState: createPlanningStreamState(),
        handleMessage: async (message, planningState, loopActiveTurn) => processPlanningStreamMessage({
          message,
          planningState,
          maxClarificationRounds: effectiveMaxClarificationRounds,
          taskId: normalizedTaskId,
          runId: run.id,
          activeTurn: loopActiveTurn,
          getNextClarificationRound: clarificationTracker.getNextRound,
          captureQuestionRequest: (question, context) => {
            approvalCoordinator.captureQuestionRequest(question, context)
          },
          capturePendingInteraction: (message, context) => capturePendingInteraction({
            message,
            context,
            capturePermissionRequest: (permission, requestContext) => {
              approvalCoordinator.capturePermissionRequest(permission, requestContext)
            },
            captureQuestionRequest: (question, requestContext) => {
              approvalCoordinator.captureQuestionRequest(question, requestContext)
            },
          }),
          upsertPendingPlan: (plan, context) => {
            planStore.upsertPendingPlan(plan, context)
          },
          failTurn: (turnId, reason) => turnRuntimeStore.failTurn(turnId, reason),
          createId: createRouteMessageId,
        }),
      },
      planningPostRunInput: {
        upsertPendingPlan: (plan, context) => {
          planStore.upsertPendingPlan(plan, context)
        },
        cancelTurn: (turnId, reason) => turnRuntimeStore.cancelTurn(turnId, reason),
        completeTurn: (turnId, artifactContent) => turnRuntimeStore.completeTurn(turnId, artifactContent),
        markTurnAwaitingApproval: (turnId) => turnRuntimeStore.markTurnAwaitingApproval(turnId),
        createId: createRouteMessageId,
      },
      failTurn: (turnId, reason) => turnRuntimeStore.failTurn(turnId, reason),
      createSessionMessage: (sessionId) => createSessionMessage(sessionId, {
        createId: createRouteMessageId,
      }),
      createDoneMessage: () => createDoneMessage({
        createId: createRouteMessageId,
      }),
      createErrorMessage: (message) => createErrorMessage(message, {
        createId: createRouteMessageId,
      }),
    })
  })
})

/**
 * POST /agent/execute
 * Phase 2: Execute approved plan
 * Body: { planId: string, prompt: string, workDir?: string, taskId?: string, attachments?: MessageAttachment[] }
 * Response: SSE stream of AgentMessage
 */
agentNewRoutes.post('/execute', async (c) => {
  if (!agentService || !agentServiceConfig) {
    return c.json(buildAgentServiceUnavailableBody(), 500)
  }

  const body = await c.req.json().catch(() => ({}))

  const executionRequestResult = await prepareExecutionRequest({
    body,
    defaultWorkDir: agentServiceConfig?.workDir || process.cwd(),
    createRun: (phase, preferredId) => agentRunStore.createRun(phase, preferredId),
    deleteRun: (runId) => agentRunStore.deleteRun(runId),
    executionStartDeps: {
      getPlanRecord: (targetPlanId) => planStore.getRecord(targetPlanId),
      getTurn: (turnId) => turnRuntimeStore.getTurn(turnId),
      findLatestTurnByTask: (taskId, states) => turnRuntimeStore.findLatestTurnByTask(taskId, states),
      startPlanExecution: (targetPlanId, context) => planStore.startExecution(targetPlanId, context),
      cancelExpiredPlanTurns: (records) => cancelTurnsForExpiredPlans(records, {
        cancelPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsCanceled(scope, reason),
      }),
      startTurnExecution: (turnId, expectedTaskVersion) => turnRuntimeStore.startExecution(turnId, expectedTaskVersion),
      markPlanOrphaned: (targetPlanId, reason, failReason) => {
        planStore.markOrphaned(targetPlanId, reason, failReason)
      },
      orphanPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsOrphaned(scope, reason),
      bootstrapPlanningFiles,
    },
  })

  if (executionRequestResult.status === 'validation_error' || executionRequestResult.status === 'response') {
    return c.json(executionRequestResult.body, executionRequestResult.statusCode)
  }

  const run = executionRequestResult.run
  const plan = executionRequestResult.plan
  const activeTurn = executionRequestResult.activeTurn
  const effectiveWorkDir = executionRequestResult.effectiveWorkDir
  const executionTaskId = executionRequestResult.executionTaskId
  const executionWorkspaceDir = executionRequestResult.executionWorkspaceDir
  const progressFilePath = executionRequestResult.progressFilePath
  const attachments = executionRequestResult.attachments
  if (executionRequestResult.planningFilesBootstrap.error) {
    console.warn('[agent-new] Failed to bootstrap planning files:', executionRequestResult.planningFilesBootstrap.error)
  }

  c.header('Content-Type', 'text/event-stream; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    const emitTurnState = createTurnStateEmitter({
      stream: s,
      getRuntime: (taskId) => turnRuntimeStore.getRuntime(taskId),
      createId: createRouteMessageId,
    })
    const executionSessionInput = resolveExecutionEntry({
      planId: plan.id,
      runId: run.id,
      prompt: executionRequestResult.promptText,
      plan,
      activeTurn,
      executionTaskId,
      progressPath: progressFilePath,
      effectiveWorkDir,
      executionWorkspaceDir,
      attachments: attachments as MessageAttachment[] | undefined,
      providerName: agentServiceConfig?.provider?.provider,
      providerModel: agentServiceConfig?.provider?.model,
      sandboxEnabled: agentServiceConfig?.sandbox?.enabled === true,
      runtimeMcpServers: agentServiceConfig?.mcp?.mcpServers as Record<string, unknown> | undefined,
      settingsMcpServers: getSettings()?.mcp?.mcpServers as Record<string, unknown> | undefined,
      streamAgentExecution: (promptForAttempt, sessionId, messageAttachments, conversation, context) => agentService!.streamExecution(
        promptForAttempt,
        sessionId,
        messageAttachments,
        conversation,
        context
      ),
      capturePendingInteraction: (message, context) => capturePendingInteraction({
        message,
        context,
        capturePermissionRequest: (permission, requestContext) => {
          approvalCoordinator.capturePermissionRequest(permission, requestContext)
        },
        captureQuestionRequest: (question, requestContext) => {
          approvalCoordinator.captureQuestionRequest(question, requestContext)
        },
      }),
      processExecutionStreamMessage,
      formatPlanForExecution: (planData, dir) => taskPlanner.formatForExecution(planData, dir),
      createObservation: createExecutionObservation,
      collectObservation: collectExecutionObservation,
      evaluateRuntimeGate,
      isAborted: () => run.isAborted,
      emitMessage: async (message) => {
        await emitSseMessage(s, message)
      },
      emitMessages: async (messages) => {
        await emitMessages(s, { messages })
      },
      emitTurnState: async (result) => {
        await emitTurnState(result)
      },
      emitMessagesAndTurnTransition: async (input) => {
        await emitMessagesAndTurnTransition(s, {
          messages: input.messages,
          turnTransition: input.turnTransition,
          emitTurnState,
        })
      },
      emitTurnTransitionAndDone: async (result) => {
        await emitTurnTransitionAndDone(s, {
          turnTransition: result && 'status' in result ? result : result ? { turn: result.turn } as TurnTransitionResult : null,
          emitTurnState,
          createId: createRouteMessageId,
        })
      },
      appendProgressEntry,
      captureQuestionRequest: (question, context) => {
        approvalCoordinator.captureQuestionRequest(question, context)
      },
      recountPendingInteractions: () => approvalCoordinator.listPending({
        taskId: executionTaskId,
        providerSessionId: run.id,
      }).length,
      markTurnAwaitingClarification: (turnId) => turnRuntimeStore.markTurnAwaitingClarification(turnId),
      markPlanOrphaned: (targetPlanId, reason, failReason) => {
        planStore.markOrphaned(targetPlanId, reason, failReason)
      },
      markPlanExecuted: (targetPlanId) => {
        planStore.markExecuted(targetPlanId)
      },
      cancelTurn: (turnId, reason) => turnRuntimeStore.cancelTurn(turnId, reason),
      failTurn: (turnId, reason) => turnRuntimeStore.failTurn(turnId, reason),
      completeTurn: (turnId, artifactContent) => turnRuntimeStore.completeTurn(turnId, artifactContent),
      cancelPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsCanceled(scope, reason),
      orphanPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsOrphaned(scope, reason),
      deleteRun: (runId) => {
        agentRunStore.deleteRun(runId)
      },
      formatExecutionSummary: formatExecutionCompletionSummary,
      logInfo: (message) => {
        console.info(message.replace('[execution-session]', '[agent-new]'))
      },
      logWarn: (message) => {
        console.warn(message.replace('[execution-session]', '[agent-new]'))
      },
      createId: createRouteMessageId,
      buildRuntimeRepairPrompt,
    })

    await runExecutionSession(executionSessionInput)
  })
})

/**
 * POST /agent
 * Direct execution (compatibility mode)
 * Body: { prompt: string, sessionId?: string, attachments?: MessageAttachment[], conversation?: ConversationMessage[] }
 * Response: SSE stream of AgentMessage
 */
agentNewRoutes.post('/', async (c) => {
  if (!agentService) {
    return c.json(buildAgentServiceUnavailableBody(), 500)
  }

  const body = await c.req.json().catch(() => ({}))
  const request = prepareDirectExecutionRequest(body)
  if (request.status === 'validation_error') {
    return c.json(request.body, request.statusCode)
  }

  c.header('Content-Type', 'text/event-stream; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    await runDirectExecutionStream({
      prompt: request.prompt,
      sessionId: request.sessionId,
      attachments: request.attachments,
      conversation: request.conversation,
      streamExecution: (prompt, sessionId, attachments, conversation) => agentService!.streamExecution(
        prompt,
        sessionId,
        attachments,
        conversation
      ),
      capturePendingInteraction: (message, context) => capturePendingInteraction({
        message,
        context,
        capturePermissionRequest: (permission, requestContext) => {
          approvalCoordinator.capturePermissionRequest(permission, requestContext)
        },
        captureQuestionRequest: (question, requestContext) => {
          approvalCoordinator.captureQuestionRequest(question, requestContext)
        },
      }),
      emitMessage: async (message) => {
        await emitSseMessage(s, message)
      },
      emitError: async (message) => {
        s.write('event: error\n')
        s.write(`data: ${JSON.stringify({ error: message })}\n\n`)
      },
    })
  })
})

/**
 * POST /agent/stop/:id
 * Stop a running run
 */
agentNewRoutes.post('/stop/:id', async (c) => {
  const result = resolveStopSessionRequest({
    sessionId: c.req.param('id'),
    stopAgentSession: (sessionId) => stopAgentSession({
      sessionId,
      stopRun: (targetSessionId, options) => agentRunStore.stopRun(targetSessionId, options),
      abortAgentSession: (runId) => agentService?.abort(runId) ?? false,
      findLatestTurnByRun: (runId, states) => turnRuntimeStore.findLatestTurnByRun(runId, states),
      cancelTurn: (turnId, reason) => {
        turnRuntimeStore.cancelTurn(turnId, reason)
      },
      cancelPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsCanceled(scope, reason),
    }),
  })
  return c.json(result.body, result.statusCode)
})

/**
 * GET /agent/run/:id
 * Get runtime run status
 */
const handleGetRunStatus = async (c: any) => {
  const result = resolveRunStatusRequest({
    sessionId: c.req.param('id'),
    getRun: (sessionId) => agentRunStore.getRun(sessionId),
  })
  return c.json(result.body, result.statusCode)
}

agentNewRoutes.get('/run/:id', handleGetRunStatus)
agentNewRoutes.get('/session/:id', handleGetRunStatus)

/**
 * GET /agent/plan/:id
 * Get plan details
 */
agentNewRoutes.get('/plan/:id', async (c) => {
  const result = resolvePlanLookupRequest({
    planId: c.req.param('id'),
    getPlan: (planId) => planStore.getPlan(planId),
  })
  return c.json(result.body, result.statusCode)
})

/**
 * GET /agent/runtime/:taskId
 * Get task runtime/turn/artifact snapshot for recovery and dependency inspection.
 */
agentNewRoutes.get('/runtime/:taskId', async (c) => {
  const result = resolveTaskRuntimeRequest({
    taskId: c.req.param('taskId'),
    getRuntime: (taskId) => turnRuntimeStore.getRuntime(taskId),
    listTurns: (taskId) => turnRuntimeStore.listTurns(taskId),
    listArtifacts: (taskId) => turnRuntimeStore.listArtifacts(taskId),
  })
  return c.json(result.body, result.statusCode)
})

/**
 * GET /agent/turn/:turnId
 * Inspect a single turn state.
 */
agentNewRoutes.get('/turn/:turnId', async (c) => {
  const result = resolveTurnLookupRequest({
    turnId: c.req.param('turnId'),
    getTurn: (turnId) => turnRuntimeStore.getTurn(turnId),
    getRuntime: (taskId) => turnRuntimeStore.getRuntime(taskId),
  })
  return c.json(result.body, result.statusCode)
})

/**
 * POST /agent/plan/reject
 * Mark a pending plan as rejected by user
 * Body: { planId: string, reason?: string }
 */
agentNewRoutes.post('/plan/reject', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const result = resolvePlanRejectRequest({
    body,
    rejectPendingPlan: (planId, reason) => rejectPendingPlan({
      planId,
      reason,
      markRejected: (targetPlanId, rejectReason) => planStore.markRejected(targetPlanId, rejectReason),
      cancelTurn: (turnId, cancelReason) => {
        turnRuntimeStore.cancelTurn(turnId, cancelReason)
      },
      cancelPendingApprovals: (scope, cancelReason) => approvalCoordinator.markPendingAsCanceled(scope, cancelReason),
    }),
  })
  return c.json(result.body, result.statusCode)
})

/**
 * GET /agent/pending
 * Get pending permission/question requests (for refresh/recovery)
 */
agentNewRoutes.get('/pending', async (c) => {
  return c.json(resolvePendingApprovalsRequest({
    taskId: c.req.query('taskId'),
    runId: c.req.query('runId'),
    sessionId: c.req.query('sessionId'),
    kind: normalizeApprovalKind(c.req.query('kind')),
    listPending: (scope) => approvalCoordinator.listPending(scope),
    getLatestTerminal: (scope) => approvalCoordinator.getLatestTerminal(scope),
  }))
})

/**
 * GET /agent/approvals/diagnostics
 * Read-only diagnostics endpoint for approval states
 */
agentNewRoutes.get('/approvals/diagnostics', async (c) => {
  return c.json(resolveApprovalDiagnosticsRequest({
    taskId: c.req.query('taskId'),
    runId: c.req.query('runId'),
    sessionId: c.req.query('sessionId'),
    kind: normalizeApprovalKind(c.req.query('kind')),
    limit: c.req.query('limit'),
    getDiagnostics: (scope, limit) => approvalCoordinator.getDiagnostics(scope, limit),
  }))
})

/**
 * POST /agent/permission
 * Respond to a permission request
 * Body: { permissionId: string, approved: boolean, reason?: string, addToAutoAllow?: boolean }
 */
agentNewRoutes.post('/permission', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const result = resolvePermissionRequest({
    body,
    resolvePermission: (permissionId, approved, reason) => approvalCoordinator.resolvePermission(permissionId, approved, reason),
    addToolToAutoAllowList: (toolName) => addToolToAutoAllowList(toolName, {
      getSettings,
      setSettings,
      saveSettingsToFile,
      normalizeApprovalSettings,
    }),
    findLatestTurnByTask: (taskId, states) => turnRuntimeStore.findLatestTurnByTask(taskId, states),
  })

  return c.json(result.body, result.statusCode)
})

/**
 * POST /agent/question
 * Respond to a pending question
 * Body: { questionId: string, answers: Record<string, string> }
 */
agentNewRoutes.post('/question', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const result = resolveQuestionRequest({
    body,
    resolveQuestion: (questionId, answers) => approvalCoordinator.resolveQuestion(questionId, answers),
    findLatestTurnByTask: (taskId, states) => turnRuntimeStore.findLatestTurnByTask(taskId, states),
  })

  return c.json(result.body, result.statusCode)
})
