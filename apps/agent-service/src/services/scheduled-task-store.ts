import * as fs from 'fs'
import { nanoid } from 'nanoid'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskListQuery,
  ScheduledTaskRun,
  ScheduledTaskRunListQuery,
  ScheduledTaskRunStatus,
  ScheduledTaskStoreData,
  ScheduledTaskTriggerType,
  UpdateScheduledTaskInput,
} from '../types/scheduled-task'
import { getNextRunAt } from './cron-utils'
import { resolveArclayPath } from '../shared/arclay-home'
import { createLogger } from '../shared/logger'

const log = createLogger('scheduled-task-store')

function getStoreDir(): string {
  return resolveArclayPath()
}

function getStoreFile(): string {
  return resolveArclayPath('scheduled-tasks.json')
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_COOLDOWN_SECONDS = 30 * 60
const DEFAULT_TIMEOUT_SECONDS = 30 * 60
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_WORKSPACE_ID = 'ws_default'

interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

function createInitialData(): ScheduledTaskStoreData {
  return {
    version: 2,
    tasks: [],
    runs: [],
  }
}

function normalizeTaskWorkspace(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    workspaceId: task.workspaceId || DEFAULT_WORKSPACE_ID,
  }
}

function sanitizePagination(page?: number, pageSize?: number): { page: number; pageSize: number } {
  const safePage = page && Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const safePageSizeRaw = pageSize && Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20
  const safePageSize = Math.min(safePageSizeRaw, 100)
  return { page: safePage, pageSize: safePageSize }
}

export class ScheduledTaskStore {
  private data: ScheduledTaskStoreData = createInitialData()

  constructor() {
    this.data = this.load()
  }

  private ensureStoreDir(): void {
    const storeDir = getStoreDir()
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true })
    }
  }

  private load(): ScheduledTaskStoreData {
    const storeFile = getStoreFile()
    try {
      if (!fs.existsSync(storeFile)) {
        return createInitialData()
      }

      const text = fs.readFileSync(storeFile, 'utf-8')
      const parsed = JSON.parse(text) as ScheduledTaskStoreData
      if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.runs)) {
        return createInitialData()
      }
      return {
        version: 2,
        tasks: parsed.tasks.map((task) => normalizeTaskWorkspace(task)),
        runs: parsed.runs,
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to load store')
      return createInitialData()
    }
  }

  private persist(): void {
    const storeFile = getStoreFile()
    try {
      this.ensureStoreDir()
      const tmpFile = `${storeFile}.tmp`
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmpFile, storeFile)
    } catch (error) {
      log.error({ err: error }, 'Failed to persist store')
      throw error
    }
  }

  private findTaskIndex(taskId: string): number {
    return this.data.tasks.findIndex((task) => task.id === taskId)
  }

  getTask(taskId: string): ScheduledTask | null {
    const task = this.data.tasks.find((item) => item.id === taskId)
    return task ? normalizeTaskWorkspace(task) : null
  }

  listTasks(query: ScheduledTaskListQuery = {}): PaginatedResult<ScheduledTask> {
    const { workspaceId, enabled, breakerState, keyword } = query
    const { page, pageSize } = sanitizePagination(query.page, query.pageSize)

    const filtered = this.data.tasks
      .map((task) => normalizeTaskWorkspace(task))
      .filter((task) => {
        if (workspaceId && task.workspaceId !== workspaceId) return false
        if (typeof enabled === 'boolean' && task.enabled !== enabled) return false
        if (breakerState && task.breakerState !== breakerState) return false
        if (keyword) {
          const q = keyword.toLowerCase()
          if (!task.name.toLowerCase().includes(q) && !task.sourcePrompt.toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)

    const total = filtered.length
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)

    return { items, total, page, pageSize }
  }

  createTask(input: CreateScheduledTaskInput): ScheduledTask {
    const now = Date.now()
    const timezone = input.timezone ?? DEFAULT_TIMEZONE
    const enabled = input.enabled ?? true
    const nextRunAt = enabled ? getNextRunAt(input.cronExpr, timezone, new Date(now)).getTime() : null

    const task: ScheduledTask = {
      id: `st_${nanoid(12)}`,
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      enabled,
      cronExpr: input.cronExpr.trim(),
      timezone,
      sourcePrompt: input.sourcePrompt,
      approvedPlan: input.approvedPlan,
      executionPromptSnapshot: input.executionPromptSnapshot,
      workDir: input.workDir,
      nextRunAt,
      lastRunAt: null,
      lastStatus: 'idle',
      consecutiveFailures: 0,
      breakerState: 'closed',
      breakerOpenedAt: null,
      breakerCooldownUntil: null,
      breakerOpenCount24h: 0,
      breakerOpenWindowStartedAt: null,
      autoDisabledByBreaker: false,
      maxConsecutiveFailures: input.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
      cooldownSeconds: input.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
      timeoutSeconds: input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      overlapPolicy: 'forbid',
      createdAt: now,
      updatedAt: now,
    }

    this.data.tasks.push(task)
    this.persist()
    return task
  }

  updateTask(taskId: string, input: UpdateScheduledTaskInput): ScheduledTask | null {
    const index = this.findTaskIndex(taskId)
    if (index === -1) return null

    const task = this.data.tasks[index]
    const now = Date.now()
    const nextEnabled = input.enabled ?? task.enabled
    const nextTimezone = input.timezone ?? task.timezone
    const nextCronExpr = input.cronExpr ?? task.cronExpr

    const nextTask: ScheduledTask = {
      ...task,
      workspaceId: input.workspaceId ?? task.workspaceId,
      name: input.name?.trim() ?? task.name,
      enabled: nextEnabled,
      cronExpr: nextCronExpr.trim(),
      timezone: nextTimezone,
      sourcePrompt: input.sourcePrompt ?? task.sourcePrompt,
      approvedPlan: input.approvedPlan ?? task.approvedPlan,
      executionPromptSnapshot: input.executionPromptSnapshot ?? task.executionPromptSnapshot,
      workDir: input.workDir ?? task.workDir,
      maxConsecutiveFailures: input.maxConsecutiveFailures ?? task.maxConsecutiveFailures,
      cooldownSeconds: input.cooldownSeconds ?? task.cooldownSeconds,
      timeoutSeconds: input.timeoutSeconds ?? task.timeoutSeconds,
      updatedAt: now,
    }

    if (!nextEnabled) {
      nextTask.nextRunAt = null
    } else if (
      input.enabled !== undefined ||
      input.cronExpr !== undefined ||
      input.timezone !== undefined ||
      task.nextRunAt === null
    ) {
      nextTask.nextRunAt = getNextRunAt(nextTask.cronExpr, nextTask.timezone, new Date(now)).getTime()
    }

    this.data.tasks[index] = nextTask
    this.persist()
    return nextTask
  }

  deleteTask(taskId: string): boolean {
    const index = this.findTaskIndex(taskId)
    if (index === -1) return false

    this.data.tasks.splice(index, 1)
    // Keep runs for history by design.
    this.persist()
    return true
  }

  reassignWorkspaceTasks(fromWorkspaceId: string, toWorkspaceId: string): number {
    if (fromWorkspaceId === toWorkspaceId) return 0

    let changed = 0
    this.data.tasks = this.data.tasks.map((task) => {
      const normalized = normalizeTaskWorkspace(task)
      if (normalized.workspaceId !== fromWorkspaceId) return normalized
      changed += 1
      return {
        ...normalized,
        workspaceId: toWorkspaceId,
        updatedAt: Date.now(),
      }
    })

    if (changed > 0) {
      this.persist()
    }
    return changed
  }

  setTaskEnabled(taskId: string, enabled: boolean): ScheduledTask | null {
    const index = this.findTaskIndex(taskId)
    if (index === -1) return null

    const task = this.data.tasks[index]
    const now = Date.now()
    const nextTask: ScheduledTask = {
      ...task,
      enabled,
      updatedAt: now,
      nextRunAt: enabled ? getNextRunAt(task.cronExpr, task.timezone, new Date(now)).getTime() : null,
    }
    this.data.tasks[index] = nextTask
    this.persist()
    return nextTask
  }

  updateTaskRuntime(taskId: string, patch: Partial<ScheduledTask>): ScheduledTask | null {
    const index = this.findTaskIndex(taskId)
    if (index === -1) return null

    const nextTask: ScheduledTask = {
      ...this.data.tasks[index],
      ...patch,
      updatedAt: Date.now(),
    }

    this.data.tasks[index] = nextTask
    this.persist()
    return nextTask
  }

  resetTaskBreaker(taskId: string): ScheduledTask | null {
    const task = this.getTask(taskId)
    if (!task) return null

    return this.updateTaskRuntime(taskId, {
      breakerState: 'closed',
      consecutiveFailures: 0,
      breakerOpenedAt: null,
      breakerCooldownUntil: null,
      breakerOpenCount24h: 0,
      breakerOpenWindowStartedAt: null,
      autoDisabledByBreaker: false,
      enabled: true,
      nextRunAt: getNextRunAt(
        task.cronExpr,
        task.timezone,
        new Date()
      ).getTime(),
    })
  }

  createRun(taskId: string, triggerType: ScheduledTaskTriggerType, scheduledAt: number | null): ScheduledTaskRun {
    const run: ScheduledTaskRun = {
      id: `str_${nanoid(14)}`,
      taskId,
      triggerType,
      scheduledAt,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'running',
      errorCode: null,
      errorMessage: null,
      durationMs: null,
      sessionId: null,
      meta: null,
    }

    this.data.runs.push(run)
    this.persist()
    return run
  }

  updateRun(
    runId: string,
    patch: Partial<Pick<ScheduledTaskRun, 'status' | 'finishedAt' | 'errorCode' | 'errorMessage' | 'durationMs' | 'sessionId' | 'meta'>>
  ): ScheduledTaskRun | null {
    const index = this.data.runs.findIndex((run) => run.id === runId)
    if (index === -1) return null

    const nextRun: ScheduledTaskRun = {
      ...this.data.runs[index],
      ...patch,
    }
    this.data.runs[index] = nextRun
    this.persist()
    return nextRun
  }

  getRun(runId: string): ScheduledTaskRun | null {
    return this.data.runs.find((run) => run.id === runId) ?? null
  }

  listRuns(query: ScheduledTaskRunListQuery = {}): PaginatedResult<ScheduledTaskRun> {
    const { taskId } = query
    const { page, pageSize } = sanitizePagination(query.page, query.pageSize)

    const filtered = this.data.runs
      .filter((run) => (taskId ? run.taskId === taskId : true))
      .sort((a, b) => b.startedAt - a.startedAt)

    const total = filtered.length
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)

    return { items, total, page, pageSize }
  }

  listDueTasks(now: number): ScheduledTask[] {
    return this.data.tasks
      .filter((task) => task.enabled && task.nextRunAt !== null && task.nextRunAt <= now)
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
  }

  listRunningRuns(): ScheduledTaskRun[] {
    return this.data.runs.filter((run) => run.status === 'running')
  }

  markRecoveredRunningRun(runId: string): ScheduledTaskRun | null {
    const run = this.getRun(runId)
    if (!run || run.status !== 'running') return null

    return this.updateRun(runId, {
      status: 'failed',
      finishedAt: Date.now(),
      durationMs: Date.now() - run.startedAt,
      errorCode: 'PROCESS_RESTART_RECOVERY',
      errorMessage: 'Marked as failed during scheduler startup recovery',
    })
  }

  finalizeRun(
    runId: string,
    status: ScheduledTaskRunStatus,
    errorCode: string | null,
    errorMessage: string | null,
    sessionId: string | null,
    meta: Record<string, unknown> | null
  ): ScheduledTaskRun | null {
    const run = this.getRun(runId)
    if (!run) return null
    const finishedAt = Date.now()
    const durationMs = finishedAt - run.startedAt

    return this.updateRun(runId, {
      status,
      finishedAt,
      durationMs,
      errorCode,
      errorMessage,
      sessionId,
      meta,
    })
  }
}

export const scheduledTaskStore = new ScheduledTaskStore()

export const scheduledTaskDefaults = {
  timezone: DEFAULT_TIMEZONE,
  maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
  cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
}
