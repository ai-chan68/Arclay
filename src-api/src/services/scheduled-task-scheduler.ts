import { getWorkDir } from '../config'
import { getAgentService } from '../routes/agent-new'
import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskRunStatus, ScheduledTaskTriggerType } from '../types/scheduled-task'
import { getNextRunAt } from './cron-utils'
import { buildExecutionPrompt } from './plan-execution'
import { bootstrapPlanningFiles } from './planning-files'
import { scheduledTaskStore } from './scheduled-task-store'

const SCHEDULER_TICK_MS = 10_000
const BREAKER_AUTO_DISABLE_THRESHOLD_24H = 3
const RUN_ERROR_MESSAGE_LIMIT = 1_000
const RUN_TIMELINE_LIMIT = 120
const RUN_LOG_ENTRY_LIMIT = 240
const RUN_LOG_MESSAGE_LIMIT = 500
const RUN_FINAL_OUTPUT_LIMIT = 8_000

interface ExecuteTaskResult {
  run: ScheduledTaskRun
  task: ScheduledTask
}

export class ScheduledTaskScheduler {
  private interval: NodeJS.Timeout | null = null
  private tickInProgress = false
  private readonly runningTaskIds = new Set<string>()

  start(): void {
    if (this.interval) return

    this.recoverStuckRuns()
    this.interval = setInterval(() => {
      void this.tick()
    }, SCHEDULER_TICK_MS)
    void this.tick()
    console.log('[ScheduledTaskScheduler] Started')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    console.log('[ScheduledTaskScheduler] Stopped')
  }

  async runNow(taskId: string): Promise<ExecuteTaskResult> {
    const task = scheduledTaskStore.getTask(taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    const run = await this.executeTask(task, 'manual', null)
    const latestTask = scheduledTaskStore.getTask(taskId)
    if (!latestTask) {
      throw new Error('Task not found after execution')
    }
    return { run, task: latestTask }
  }

  private async tick(): Promise<void> {
    if (this.tickInProgress) return
    this.tickInProgress = true

    try {
      const now = Date.now()
      const dueTasks = scheduledTaskStore.listDueTasks(now)

      for (const task of dueTasks) {
        if (!task.enabled) continue

        let triggerType: ScheduledTaskTriggerType = 'cron'
        if (task.breakerState === 'open') {
          if (task.breakerCooldownUntil && now < task.breakerCooldownUntil) {
            continue
          }
          scheduledTaskStore.updateTaskRuntime(task.id, {
            breakerState: 'half_open',
            nextRunAt: now,
          })
          triggerType = 'recovery_probe'
        } else if (task.breakerState === 'half_open') {
          triggerType = 'recovery_probe'
        }

        await this.executeTask(task, triggerType, task.nextRunAt)
      }
    } catch (error) {
      console.error('[ScheduledTaskScheduler] Tick failed:', error)
    } finally {
      this.tickInProgress = false
    }
  }

  private recoverStuckRuns(): void {
    const runningRuns = scheduledTaskStore.listRunningRuns()
    for (const run of runningRuns) {
      scheduledTaskStore.markRecoveredRunningRun(run.id)
      const task = scheduledTaskStore.getTask(run.taskId)
      if (task) {
        scheduledTaskStore.updateTaskRuntime(task.id, {
          lastStatus: 'failed',
          consecutiveFailures: task.consecutiveFailures + 1,
          nextRunAt: this.computeNextRun(task),
        })
      }
    }
    if (runningRuns.length > 0) {
      console.log(`[ScheduledTaskScheduler] Recovered ${runningRuns.length} running runs`)
    }
  }

  private normalizeErrorMessage(message: string): string {
    const trimmed = message.trim()
    if (trimmed.length <= RUN_ERROR_MESSAGE_LIMIT) {
      return trimmed
    }
    return `${trimmed.slice(0, RUN_ERROR_MESSAGE_LIMIT)}...`
  }

  private getExecutionPrompt(task: ScheduledTask): string {
    if (task.executionPromptSnapshot && task.executionPromptSnapshot.trim() !== '') {
      return task.executionPromptSnapshot
    }

    if (!task.approvedPlan) {
      return task.sourcePrompt
    }

    const workDir = task.workDir || getWorkDir()
    return buildExecutionPrompt(task.approvedPlan, task.sourcePrompt, workDir)
  }

  private computeNextRun(task: ScheduledTask, baseTime = Date.now()): number | null {
    if (!task.enabled) return null
    try {
      return getNextRunAt(task.cronExpr, task.timezone, new Date(baseTime)).getTime()
    } catch (error) {
      console.error(`[ScheduledTaskScheduler] Failed to compute next run for task ${task.id}:`, error)
      return null
    }
  }

  private applyBreakerOnFailure(task: ScheduledTask, now: number): Partial<ScheduledTask> {
    const nextConsecutiveFailures = task.consecutiveFailures + 1
    const shouldOpen = task.breakerState === 'half_open' || nextConsecutiveFailures >= task.maxConsecutiveFailures

    if (!shouldOpen) {
      return {
        consecutiveFailures: nextConsecutiveFailures,
        breakerState: task.breakerState,
        nextRunAt: this.computeNextRun(task, now),
      }
    }

    const cooldownUntil = now + task.cooldownSeconds * 1000
    let breakerOpenCount24h = task.breakerOpenCount24h
    let breakerOpenWindowStartedAt = task.breakerOpenWindowStartedAt

    if (!breakerOpenWindowStartedAt || now - breakerOpenWindowStartedAt > 24 * 60 * 60 * 1000) {
      breakerOpenWindowStartedAt = now
      breakerOpenCount24h = 1
    } else {
      breakerOpenCount24h += 1
    }

    const autoDisable = breakerOpenCount24h >= BREAKER_AUTO_DISABLE_THRESHOLD_24H

    return {
      consecutiveFailures: nextConsecutiveFailures,
      breakerState: 'open',
      breakerOpenedAt: now,
      breakerCooldownUntil: cooldownUntil,
      breakerOpenCount24h,
      breakerOpenWindowStartedAt,
      autoDisabledByBreaker: autoDisable || task.autoDisabledByBreaker,
      enabled: autoDisable ? false : task.enabled,
      nextRunAt: autoDisable ? null : cooldownUntil,
    }
  }

  private applyBreakerOnSuccess(task: ScheduledTask, now: number): Partial<ScheduledTask> {
    return {
      consecutiveFailures: 0,
      breakerState: 'closed',
      breakerOpenedAt: null,
      breakerCooldownUntil: null,
      autoDisabledByBreaker: false,
      nextRunAt: this.computeNextRun(task, now),
    }
  }

  private async executeTask(
    inputTask: ScheduledTask,
    triggerType: ScheduledTaskTriggerType,
    scheduledAt: number | null
  ): Promise<ScheduledTaskRun> {
    const freshTask = scheduledTaskStore.getTask(inputTask.id)
    if (!freshTask) {
      throw new Error('Task not found')
    }

    if (freshTask.overlapPolicy === 'forbid' && this.runningTaskIds.has(freshTask.id)) {
      const skippedRun = scheduledTaskStore.createRun(freshTask.id, triggerType, scheduledAt)
      const skippedAt = Date.now()
      const finalized = scheduledTaskStore.finalizeRun(
        skippedRun.id,
        'skipped',
        'OVERLAP_FORBIDDEN',
        'Task is already running',
        null,
        {
          triggerType,
          scheduledAt,
          timeline: [
            {
              at: skippedAt,
              event: 'run_skipped',
              detail: 'Task is already running and overlapPolicy=forbid',
            },
          ],
          logs: [
            {
              at: skippedAt,
              level: 'error',
              message: 'Task is already running',
            },
          ],
          stats: {
            messageCount: 0,
            toolUseCount: 0,
            toolResultCount: 0,
            errorCount: 1,
            timelineTruncated: false,
            logsTruncated: false,
          },
        }
      )
      if (!finalized) {
        throw new Error('Failed to finalize skipped run')
      }
      return finalized
    }

    this.runningTaskIds.add(freshTask.id)
    const startedAt = Date.now()
    const run = scheduledTaskStore.createRun(freshTask.id, triggerType, scheduledAt)
    const sessionId = `sched_${freshTask.id}_${startedAt}`

    const nextRunAtForRunning = triggerType === 'manual'
      ? freshTask.nextRunAt
      : this.computeNextRun(freshTask, startedAt)

    scheduledTaskStore.updateTaskRuntime(freshTask.id, {
      lastStatus: 'running',
      lastRunAt: startedAt,
      nextRunAt: nextRunAtForRunning,
    })

    let status: ScheduledTaskRunStatus = 'success'
    let errorCode: string | null = null
    let errorMessage: string | null = null
    let timedOut = false
    let messageCount = 0
    let toolUseCount = 0
    let toolResultCount = 0
    let errorCount = 0
    let timelineTruncated = false
    let logsTruncated = false
    const timeline: Array<{ at: number; event: string; detail?: string }> = []
    const logs: Array<{ at: number; level: 'info' | 'error'; message: string }> = []
    let lastAssistantText: string | null = null
    let finalResultText: string | null = null
    const toolNameByUseId = new Map<string, string>()

    const truncateText = (value: string, limit: number): string => {
      const trimmed = value.trim()
      if (trimmed.length <= limit) {
        return trimmed
      }
      return `${trimmed.slice(0, limit)}...`
    }

    const stringifyBrief = (payload: unknown): string | null => {
      if (payload === null || payload === undefined) return null
      if (typeof payload === 'string') return truncateText(payload, RUN_LOG_MESSAGE_LIMIT)
      try {
        return truncateText(JSON.stringify(payload), RUN_LOG_MESSAGE_LIMIT)
      } catch {
        return null
      }
    }

    const pushTimeline = (event: string, detail?: string, at = Date.now()): void => {
      if (timeline.length >= RUN_TIMELINE_LIMIT) {
        timelineTruncated = true
        return
      }
      timeline.push({
        at,
        event,
        ...(detail ? { detail: truncateText(detail, RUN_LOG_MESSAGE_LIMIT) } : {}),
      })
    }

    const pushLog = (level: 'info' | 'error', message: string, at = Date.now()): void => {
      if (!message.trim()) return
      if (logs.length >= RUN_LOG_ENTRY_LIMIT) {
        logsTruncated = true
        return
      }
      logs.push({
        at,
        level,
        message: truncateText(message, RUN_LOG_MESSAGE_LIMIT),
      })
    }

    pushTimeline('run_started', `trigger=${triggerType}`, startedAt)
    if (scheduledAt) {
      pushTimeline('scheduled_at', new Date(scheduledAt).toISOString(), scheduledAt)
    }
    pushLog('info', `Run started with trigger=${triggerType}`, startedAt)

    try {
      const agentService = getAgentService()
      if (!agentService) {
        throw new Error('Agent service not initialized')
      }

      const timeoutMs = freshTask.timeoutSeconds * 1000
      const timeoutHandle = setTimeout(() => {
        timedOut = true
        const timeoutMessage = `Execution timed out after ${freshTask.timeoutSeconds} seconds`
        pushTimeline('timeout_abort_requested', timeoutMessage)
        pushLog('error', timeoutMessage)
        agentService.abort(sessionId)
      }, timeoutMs)

      try {
        const executionPrompt = this.getExecutionPrompt(freshTask)
        const taskWorkDir = freshTask.workDir || getWorkDir()
        const bootstrapResult = await bootstrapPlanningFiles({
          workDir: taskWorkDir,
          taskId: freshTask.id,
          goal: freshTask.approvedPlan?.goal || freshTask.sourcePrompt,
          steps: (freshTask.approvedPlan?.steps || []).map((step) => step.description),
          notes: freshTask.approvedPlan?.notes,
          originalPrompt: freshTask.sourcePrompt,
        })
        if (bootstrapResult.error) {
          pushLog('error', `planning files bootstrap failed: ${bootstrapResult.error}`)
          pushTimeline('planning_files_bootstrap_failed', bootstrapResult.error)
        } else if (bootstrapResult.createdFiles.length > 0) {
          pushLog('info', `planning files bootstrap created: ${bootstrapResult.createdFiles.join(', ')}`)
        }
        pushTimeline('agent_stream_started')
        for await (const message of agentService.streamExecution(executionPrompt, sessionId, undefined, undefined, {
          workDir: taskWorkDir,
          taskId: freshTask.id,
        })) {
          messageCount += 1
          const messageAt = message.timestamp || Date.now()

          if (message.type === 'tool_use') {
            toolUseCount += 1
            const toolName = message.toolName || 'unknown_tool'
            if (message.toolUseId) {
              toolNameByUseId.set(message.toolUseId, toolName)
            }
            pushTimeline('tool_use', toolName, messageAt)
            const inputPreview = stringifyBrief(message.toolInput)
            pushLog('info', inputPreview ? `tool_use ${toolName}: ${inputPreview}` : `tool_use ${toolName}`, messageAt)
            continue
          }

          if (message.type === 'tool_result') {
            toolResultCount += 1
            const toolName = message.toolName || (message.toolUseId ? toolNameByUseId.get(message.toolUseId) : null) || 'unknown_tool'
            pushTimeline('tool_result', toolName, messageAt)
            if (message.toolOutput) {
              pushLog('info', `tool_result ${toolName}: ${message.toolOutput}`, messageAt)
            } else {
              pushLog('info', `tool_result ${toolName}`, messageAt)
            }
            continue
          }

          if (message.type === 'text') {
            if (message.content && message.content.trim() !== '') {
              pushLog('info', message.content, messageAt)
              if (!message.role || message.role === 'assistant') {
                lastAssistantText = message.content.trim()
              }
            }
            continue
          }

          if (message.type === 'result') {
            pushTimeline('agent_result', message.content || 'result', messageAt)
            if (message.content) {
              finalResultText = message.content.trim()
              pushLog('info', message.content, messageAt)
            }
            continue
          }

          if (message.type === 'error') {
            errorCount += 1
            errorCode = 'AGENT_EXECUTION_ERROR'
            errorMessage = message.errorMessage || 'Unknown agent execution error'
            pushTimeline('agent_error', errorMessage, messageAt)
            pushLog('error', errorMessage, messageAt)
            continue
          }

          if (message.type === 'done') {
            pushTimeline('agent_done', undefined, messageAt)
            continue
          }

          if (message.type === 'session' && message.sessionId) {
            pushTimeline('agent_session', message.sessionId, messageAt)
            continue
          }

          pushTimeline(`agent_${message.type}`, undefined, messageAt)
        }
      } finally {
        clearTimeout(timeoutHandle)
        pushTimeline('agent_stream_stopped')
      }

      if (timedOut) {
        status = 'timeout'
        errorCode = 'EXECUTION_TIMEOUT'
        errorMessage = `Execution timed out after ${freshTask.timeoutSeconds} seconds`
      } else if (errorMessage) {
        status = 'failed'
      } else {
        status = 'success'
      }
    } catch (error) {
      status = 'failed'
      errorCode = errorCode ?? 'EXECUTION_FAILED'
      errorMessage = error instanceof Error ? error.message : 'Unknown execution failure'
      errorCount += 1
      pushTimeline('execution_exception', errorMessage)
      pushLog('error', errorMessage)
    } finally {
      this.runningTaskIds.delete(freshTask.id)
    }

    const now = Date.now()
    pushTimeline('run_finished', `status=${status}`, now)
    pushLog('info', `Run finished with status=${status}`, now)
    const finalOutput = finalResultText || lastAssistantText
    const normalizedErrorMessage = errorMessage ? this.normalizeErrorMessage(errorMessage) : null
    const finalizedRun = scheduledTaskStore.finalizeRun(
      run.id,
      status,
      errorCode,
      normalizedErrorMessage,
      sessionId,
      {
        triggerType,
        scheduledAt,
        timeoutSeconds: freshTask.timeoutSeconds,
        timedOut,
        result: {
          finalOutput: finalOutput ? truncateText(finalOutput, RUN_FINAL_OUTPUT_LIMIT) : null,
          source: finalResultText ? 'result' : (lastAssistantText ? 'assistant_text' : null),
        },
        timeline,
        logs,
        stats: {
          messageCount,
          toolUseCount,
          toolResultCount,
          errorCount,
          timelineTruncated,
          logsTruncated,
        },
      }
    )
    if (!finalizedRun) {
      throw new Error('Failed to finalize run')
    }

    const latestTask = scheduledTaskStore.getTask(freshTask.id)
    if (!latestTask) {
      return finalizedRun
    }

    if (status === 'success') {
      const successPatch = triggerType === 'manual'
        ? {
            lastStatus: 'success' as const,
            lastRunAt: finalizedRun.startedAt,
          }
        : {
            lastStatus: 'success' as const,
            lastRunAt: finalizedRun.startedAt,
            ...this.applyBreakerOnSuccess(latestTask, now),
          }

      scheduledTaskStore.updateTaskRuntime(latestTask.id, successPatch)
      return finalizedRun
    }

    const failedStatus = status === 'timeout' ? 'timeout' : 'failed'
    const failurePatch = triggerType === 'manual'
      ? {
          lastStatus: failedStatus as ScheduledTask['lastStatus'],
          lastRunAt: finalizedRun.startedAt,
        }
      : {
          lastStatus: failedStatus as ScheduledTask['lastStatus'],
          lastRunAt: finalizedRun.startedAt,
          ...this.applyBreakerOnFailure(latestTask, now),
        }

    scheduledTaskStore.updateTaskRuntime(latestTask.id, failurePatch)
    return finalizedRun
  }
}

export const scheduledTaskScheduler = new ScheduledTaskScheduler()
