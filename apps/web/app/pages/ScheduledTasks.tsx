import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CalendarClock,
  Clock3,
  History,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { useSidebar } from '@/components/task-detail/SidebarContext'
import { LeftSidebar, type UITask } from '@/components/task-detail/LeftSidebar'
import { useDatabase } from '@/shared/hooks/useDatabase'
import { api, apiFetchRaw } from '@/shared/api'
import { cn } from '@/shared/lib/utils'
import type { Task, TaskPlan } from '@shared-types'

type BreakerState = 'closed' | 'open' | 'half_open'
type RunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'skipped'

interface ScheduledTaskItem {
  id: string
  name: string
  enabled: boolean
  cronExpr: string
  timezone: string
  sourcePrompt: string
  approvedPlan: TaskPlan | null
  executionPromptSnapshot: string
  workDir?: string
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: string
  consecutiveFailures: number
  breakerState: BreakerState
  breakerOpenedAt: number | null
  breakerCooldownUntil: number | null
  autoDisabledByBreaker: boolean
  maxConsecutiveFailures: number
  cooldownSeconds: number
  timeoutSeconds: number
  createdAt: number
  updatedAt: number
}

interface ScheduledTaskRun {
  id: string
  taskId: string
  triggerType: 'cron' | 'manual' | 'recovery_probe'
  scheduledAt: number | null
  startedAt: number
  finishedAt: number | null
  status: RunStatus
  errorCode: string | null
  errorMessage: string | null
  durationMs: number | null
  sessionId: string | null
  meta: Record<string, unknown> | null
}

interface RunTimelineItem {
  at: number
  event: string
  detail?: string
}

interface RunLogItem {
  at: number
  level: 'info' | 'error'
  message: string
}

interface RunStats {
  messageCount: number
  toolUseCount: number
  toolResultCount: number
  errorCount: number
  timelineTruncated: boolean
  logsTruncated: boolean
}

interface RunResultInfo {
  finalOutput: string | null
  source: 'result' | 'assistant_text' | null
}

interface CronSuggestion {
  expr: string
  description: string
  confidence: 'high' | 'medium'
}

interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

interface ScheduledTaskLocationState {
  sourcePrompt?: string
  approvedPlan?: TaskPlan
}

interface ScheduledTaskFormState {
  name: string
  enabled: boolean
  cronExpr: string
  timezone: string
  sourcePrompt: string
  approvedPlanJson: string
  executionPromptSnapshot: string
  maxConsecutiveFailures: string
  cooldownSeconds: string
  timeoutSeconds: string
}

const DEFAULT_TIMEZONE = 'Asia/Shanghai'

function toUITask(task: Task): UITask {
  return {
    ...task,
    title: task.title || task.prompt.slice(0, 50) + (task.prompt.length > 50 ? '...' : ''),
    phase: 'idle',
    selectedArtifactId: null,
    previewMode: 'static',
    isRightSidebarVisible: false,
    messages: [],
  }
}

function toLocalTimeLabel(timestamp: number | null): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs < 0) return '-'
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${(durationMs / 60_000).toFixed(1)}min`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readTimeline(meta: Record<string, unknown> | null): RunTimelineItem[] {
  const timelineValue = meta?.timeline
  if (!Array.isArray(timelineValue)) return []

  const timeline: RunTimelineItem[] = []
  for (const item of timelineValue) {
    const row = asRecord(item)
    if (!row) continue
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) continue
    if (typeof row.event !== 'string' || row.event.trim() === '') continue

    const detail = typeof row.detail === 'string' && row.detail.trim() !== '' ? row.detail : undefined
    timeline.push({ at: row.at, event: row.event, ...(detail ? { detail } : {}) })
  }

  timeline.sort((a, b) => a.at - b.at)
  return timeline
}

function readLogs(meta: Record<string, unknown> | null): RunLogItem[] {
  const logsValue = meta?.logs
  if (!Array.isArray(logsValue)) return []

  const logs: RunLogItem[] = []
  for (const item of logsValue) {
    const row = asRecord(item)
    if (!row) continue
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) continue
    if (typeof row.message !== 'string' || row.message.trim() === '') continue
    const level = row.level === 'error' ? 'error' : 'info'
    logs.push({ at: row.at, level, message: row.message })
  }

  logs.sort((a, b) => a.at - b.at)
  return logs
}

function readRunStats(meta: Record<string, unknown> | null): RunStats | null {
  const stats = asRecord(meta?.stats)
  if (!stats) return null
  if (
    typeof stats.messageCount !== 'number' ||
    typeof stats.toolUseCount !== 'number' ||
    typeof stats.toolResultCount !== 'number' ||
    typeof stats.errorCount !== 'number' ||
    typeof stats.timelineTruncated !== 'boolean' ||
    typeof stats.logsTruncated !== 'boolean'
  ) {
    return null
  }

  return {
    messageCount: stats.messageCount,
    toolUseCount: stats.toolUseCount,
    toolResultCount: stats.toolResultCount,
    errorCount: stats.errorCount,
    timelineTruncated: stats.timelineTruncated,
    logsTruncated: stats.logsTruncated,
  }
}

function readRunResult(meta: Record<string, unknown> | null): RunResultInfo | null {
  const result = asRecord(meta?.result)
  if (!result) return null

  const finalOutput = typeof result.finalOutput === 'string'
    ? result.finalOutput
    : result.finalOutput === null ? null : null
  const source = result.source === 'result' || result.source === 'assistant_text'
    ? result.source
    : result.source === null ? null : null

  return {
    finalOutput,
    source,
  }
}

function formatPlanJson(plan?: TaskPlan | null): string {
  if (!plan) {
    return JSON.stringify({
      id: `plan_${Date.now()}`,
      goal: '请填写任务目标',
      steps: [
        { id: 'step_1', description: '步骤一', status: 'pending' },
      ],
      notes: '',
      createdAt: new Date().toISOString(),
    }, null, 2)
  }

  return JSON.stringify({
    ...plan,
    createdAt: plan.createdAt instanceof Date ? plan.createdAt.toISOString() : plan.createdAt,
  }, null, 2)
}

function createEmptyFormState(): ScheduledTaskFormState {
  return {
    name: '',
    enabled: true,
    cronExpr: '0 9 * * 1-5',
    timezone: DEFAULT_TIMEZONE,
    sourcePrompt: '',
    approvedPlanJson: formatPlanJson(null),
    executionPromptSnapshot: '',
    maxConsecutiveFailures: '3',
    cooldownSeconds: '1800',
    timeoutSeconds: '1800',
  }
}

function ScheduledTasksContent() {
  const { isLeftOpen, toggleLeft } = useSidebar()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as ScheduledTaskLocationState | null
  const prefillHandledRef = useRef(false)

  const { isReady, loadAllTasks, deleteTask, updateTask } = useDatabase()
  const [sidebarTasks, setSidebarTasks] = useState<Task[]>([])
  const [taskItems, setTaskItems] = useState<ScheduledTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduledTaskFormState>(createEmptyFormState)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [planSuggestLoading, setPlanSuggestLoading] = useState(false)
  const [planSuggestError, setPlanSuggestError] = useState<string | null>(null)

  const [previewRuns, setPreviewRuns] = useState<string[]>([])
  const [cronDescription, setCronDescription] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [nlCronText, setNlCronText] = useState('')
  const [nlCronLoading, setNlCronLoading] = useState(false)
  const [nlCronError, setNlCronError] = useState<string | null>(null)
  const [nlCronSuggestions, setNlCronSuggestions] = useState<CronSuggestion[]>([])

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [runsLoading, setRunsLoading] = useState(false)
  const [taskRuns, setTaskRuns] = useState<ScheduledTaskRun[]>([])
  const [runDetailOpen, setRunDetailOpen] = useState(false)
  const [runDetail, setRunDetail] = useState<ScheduledTaskRun | null>(null)
  const [runDetailTaskName, setRunDetailTaskName] = useState('')
  const [runDetailLoading, setRunDetailLoading] = useState(false)
  const [runDetailError, setRunDetailError] = useState<string | null>(null)

  const loadSidebarTasks = useCallback(async () => {
    if (!isReady) return
    try {
      const all = await loadAllTasks()
      setSidebarTasks(all)
    } catch (err) {
      console.error('[ScheduledTasks] Failed to load sidebar tasks:', err)
    }
  }, [isReady, loadAllTasks])

  const loadScheduledTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PaginatedResult<ScheduledTaskItem>>('/api/scheduled-tasks?page=1&pageSize=200')
      setTaskItems(data.items)
    } catch (err) {
      console.error('[ScheduledTasks] Failed to load scheduled tasks:', err)
      setError(err instanceof Error ? err.message : '加载定时任务失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSidebarTasks()
  }, [loadSidebarTasks])

  useEffect(() => {
    void loadScheduledTasks()
  }, [loadScheduledTasks])

  useEffect(() => {
    if (prefillHandledRef.current) return
    if (!locationState?.sourcePrompt && !locationState?.approvedPlan) return

    prefillHandledRef.current = true
    setShowFormModal(true)
    setEditingTaskId(null)
    setForm((prev) => ({
      ...prev,
      name: prev.name || '新定时任务',
      sourcePrompt: locationState.sourcePrompt || prev.sourcePrompt,
      approvedPlanJson: formatPlanJson(locationState.approvedPlan),
    }))
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, locationState, navigate])

  const refreshCronPreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const query = new URLSearchParams({
        expr: form.cronExpr.trim(),
        timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
        count: '5',
      })

      const explain = await api.get<{ valid: boolean; description: string }>(`/api/scheduled-tasks/cron/explain?${query.toString()}`)
      setCronDescription(explain.description || '')

      const data = await api.get<{ valid: boolean; upcomingRuns: string[] }>(`/api/scheduled-tasks/cron/preview?${query.toString()}`)
      setPreviewRuns(data.upcomingRuns || [])
    } catch (err) {
      setCronDescription('')
      setPreviewRuns([])
      setPreviewError(err instanceof Error ? err.message : 'Cron 预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }, [form.cronExpr, form.timezone])

  useEffect(() => {
    if (!showFormModal) return
    void refreshCronPreview()
  }, [refreshCronPreview, showFormModal])

  const openCreateModal = useCallback(() => {
    setEditingTaskId(null)
    setForm(createEmptyFormState())
    setFormError(null)
    setPlanSuggestError(null)
    setCronDescription('')
    setNlCronText('')
    setNlCronError(null)
    setNlCronSuggestions([])
    setPreviewRuns([])
    setPreviewError(null)
    setShowFormModal(true)
  }, [])

  const openEditModal = useCallback((task: ScheduledTaskItem) => {
    setEditingTaskId(task.id)
    setForm({
      name: task.name,
      enabled: task.enabled,
      cronExpr: task.cronExpr,
      timezone: task.timezone || DEFAULT_TIMEZONE,
      sourcePrompt: task.sourcePrompt,
      approvedPlanJson: formatPlanJson(task.approvedPlan),
      executionPromptSnapshot: task.executionPromptSnapshot || '',
      maxConsecutiveFailures: String(task.maxConsecutiveFailures),
      cooldownSeconds: String(task.cooldownSeconds),
      timeoutSeconds: String(task.timeoutSeconds),
    })
    setFormError(null)
    setPlanSuggestError(null)
    setCronDescription('')
    setNlCronText('')
    setNlCronError(null)
    setNlCronSuggestions([])
    setPreviewRuns([])
    setPreviewError(null)
    setShowFormModal(true)
  }, [])

  const closeFormModal = useCallback(() => {
    setShowFormModal(false)
    setFormError(null)
    setPlanSuggestError(null)
    setCronDescription('')
    setNlCronText('')
    setNlCronError(null)
    setNlCronSuggestions([])
    setPreviewRuns([])
    setPreviewError(null)
  }, [])

  const handleSuggestCronFromText = useCallback(async () => {
    const text = nlCronText.trim()
    if (!text) {
      setNlCronError('请先输入诉求描述')
      setNlCronSuggestions([])
      return
    }

    setNlCronLoading(true)
    setNlCronError(null)
    try {
      const response = await api.post<{ suggestions: CronSuggestion[] }>('/api/scheduled-tasks/cron/suggest', {
        text,
        timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
      })
      const suggestions = response.suggestions || []
      setNlCronSuggestions(suggestions)

      if (suggestions.length === 0) {
        setNlCronError('暂未识别出可用 Cron，请尝试更明确的描述（例如“工作日9点”）')
        return
      }

      // 默认采用首个候选，并刷新解释/预览。
      setForm((prev) => ({ ...prev, cronExpr: suggestions[0].expr }))
    } catch (err) {
      setNlCronSuggestions([])
      setNlCronError(err instanceof Error ? err.message : '转换失败')
    } finally {
      setNlCronLoading(false)
    }
  }, [form.timezone, nlCronText])

  const applySuggestedCron = useCallback((expr: string) => {
    setForm((prev) => ({ ...prev, cronExpr: expr }))
  }, [])

  const handleSuggestPlan = useCallback(async () => {
    const prompt = form.sourcePrompt.trim()
    if (!prompt) {
      setPlanSuggestError('请先填写用户指令，再生成推荐 Plan')
      return
    }

    setPlanSuggestLoading(true)
    setPlanSuggestError(null)
    try {
      const result = await api.post<{ plan: TaskPlan }>('/api/scheduled-tasks/plan/suggest', {
        prompt,
      })

      if (!result.plan) {
        throw new Error('未返回可用 Plan')
      }

      setForm((prev) => ({
        ...prev,
        approvedPlanJson: formatPlanJson(result.plan),
      }))
    } catch (err) {
      setPlanSuggestError(err instanceof Error ? err.message : '生成推荐 Plan 失败')
    } finally {
      setPlanSuggestLoading(false)
    }
  }, [form.sourcePrompt])

  const parsePlan = useCallback((json: string): TaskPlan => {
    const parsed = JSON.parse(json) as TaskPlan
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Plan JSON 格式不正确')
    }
    if (!parsed.id || !parsed.goal || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error('Plan JSON 缺少必填字段（id/goal/steps）')
    }
    return parsed
  }, [])

  const handleSubmitForm = useCallback(async () => {
    setSaving(true)
    setFormError(null)
    try {
      const approvedPlan = parsePlan(form.approvedPlanJson)
      const payload = {
        name: form.name.trim(),
        enabled: form.enabled,
        cronExpr: form.cronExpr.trim(),
        timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
        sourcePrompt: form.sourcePrompt.trim(),
        approvedPlan,
        executionPromptSnapshot: form.executionPromptSnapshot.trim() || undefined,
        maxConsecutiveFailures: Number(form.maxConsecutiveFailures),
        cooldownSeconds: Number(form.cooldownSeconds),
        timeoutSeconds: Number(form.timeoutSeconds),
      }

      if (!payload.name || !payload.sourcePrompt || !payload.cronExpr) {
        throw new Error('名称、Cron 和指令为必填项')
      }

      if (editingTaskId) {
        await apiFetchPatch(`/api/scheduled-tasks/${editingTaskId}`, payload)
      } else {
        await api.post('/api/scheduled-tasks', payload)
      }

      closeFormModal()
      await loadScheduledTasks()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [closeFormModal, editingTaskId, form, loadScheduledTasks, parsePlan])

  const handleDeleteScheduledTask = useCallback(async (taskId: string) => {
    if (!confirm('确定要删除这个定时任务吗？')) return
    try {
      await api.delete(`/api/scheduled-tasks/${taskId}`)
      if (expandedTaskId === taskId) {
        setExpandedTaskId(null)
        setTaskRuns([])
      }
      await loadScheduledTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }, [expandedTaskId, loadScheduledTasks])

  const handleToggleEnabled = useCallback(async (task: ScheduledTaskItem) => {
    try {
      if (task.enabled) {
        await api.post(`/api/scheduled-tasks/${task.id}/disable`)
      } else {
        await api.post(`/api/scheduled-tasks/${task.id}/enable`)
      }
      await loadScheduledTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态切换失败')
    }
  }, [loadScheduledTasks])

  const handleRunNow = useCallback(async (taskId: string) => {
    try {
      await api.post(`/api/scheduled-tasks/${taskId}/run-now`)
      setTimeout(() => {
        void loadScheduledTasks()
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发失败')
    }
  }, [loadScheduledTasks])

  const handleResetBreaker = useCallback(async (taskId: string) => {
    try {
      await api.post(`/api/scheduled-tasks/${taskId}/reset-breaker`)
      await loadScheduledTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置熔断失败')
    }
  }, [loadScheduledTasks])

  const loadRunsForTask = useCallback(async (taskId: string) => {
    setRunsLoading(true)
    try {
      const data = await api.get<PaginatedResult<ScheduledTaskRun>>(`/api/scheduled-tasks/${taskId}/runs?page=1&pageSize=20`)
      setTaskRuns(data.items)
    } catch (err) {
      setTaskRuns([])
      setError(err instanceof Error ? err.message : '加载运行历史失败')
    } finally {
      setRunsLoading(false)
    }
  }, [])

  const handleToggleRuns = useCallback(async (taskId: string) => {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null)
      setTaskRuns([])
      return
    }
    setExpandedTaskId(taskId)
    await loadRunsForTask(taskId)
  }, [expandedTaskId, loadRunsForTask])

  useEffect(() => {
    if (!expandedTaskId) return
    const hasRunning = taskRuns.some((run) => run.status === 'running')
    if (!hasRunning) return

    const timer = setInterval(() => {
      void loadRunsForTask(expandedTaskId)
    }, 2000)
    return () => clearInterval(timer)
  }, [expandedTaskId, loadRunsForTask, taskRuns])

  const loadRunDetail = useCallback(async (runId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) {
      setRunDetailLoading(true)
      setRunDetailError(null)
    }

    try {
      const data = await api.get<ScheduledTaskRun>(`/api/scheduled-tasks/runs/${runId}`)
      setRunDetail(data)
      setTaskRuns((prev) => prev.map((run) => (run.id === data.id ? data : run)))
      setRunDetailError(null)
    } catch (err) {
      setRunDetailError(err instanceof Error ? err.message : '加载运行详情失败')
    } finally {
      if (!silent) {
        setRunDetailLoading(false)
      }
    }
  }, [])

  const openRunDetail = useCallback((run: ScheduledTaskRun, taskName: string) => {
    setRunDetailOpen(true)
    setRunDetailTaskName(taskName)
    setRunDetail(run)
    setRunDetailError(null)
    setRunDetailLoading(true)
    void loadRunDetail(run.id)
  }, [loadRunDetail])

  const closeRunDetail = useCallback(() => {
    setRunDetailOpen(false)
    setRunDetail(null)
    setRunDetailTaskName('')
    setRunDetailError(null)
    setRunDetailLoading(false)
  }, [])

  useEffect(() => {
    if (!runDetailOpen || !runDetail || runDetail.status !== 'running') return
    const timer = setInterval(() => {
      void loadRunDetail(runDetail.id, { silent: true })
    }, 2000)
    return () => clearInterval(timer)
  }, [loadRunDetail, runDetail, runDetailOpen])

  const sidebarUiTasks = useMemo(() => sidebarTasks.map(toUITask), [sidebarTasks])
  const runMeta = useMemo(() => asRecord(runDetail?.meta), [runDetail?.meta])
  const runTimeline = useMemo(() => readTimeline(runMeta), [runMeta])
  const runLogs = useMemo(() => readLogs(runMeta), [runMeta])
  const runStats = useMemo(() => readRunStats(runMeta), [runMeta])
  const runResult = useMemo(() => readRunResult(runMeta), [runMeta])

  const statusBadgeClass = (state: BreakerState): string => {
    switch (state) {
      case 'closed':
        return 'ew-badge text-emerald-600'
      case 'half_open':
        return 'ew-badge text-amber-700'
      case 'open':
        return 'ew-badge text-red-600'
      default:
        return 'ew-badge'
    }
  }

  return (
    <div className="ew-shell flex h-screen overflow-hidden">
      <LeftSidebar
        tasks={sidebarUiTasks}
        onSelectTask={(id) => navigate(`/task/${id}`)}
        onNewTask={() => navigate('/')}
        onDeleteTask={async (id) => {
          await deleteTask(id)
          await loadSidebarTasks()
        }}
        onToggleFavorite={async (id, favorite) => {
          await updateTask(id, { favorite })
          await loadSidebarTasks()
        }}
        isCollapsed={!isLeftOpen}
        onToggleCollapse={toggleLeft}
      />

      <main className="ew-main-panel my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="ew-title flex items-center gap-2 text-lg font-semibold">
              <CalendarClock className="size-5" />
              定时任务
            </h1>
            <p className="ew-subtext mt-1 text-sm">Cron 调度 + 运行历史 + 自动熔断</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadScheduledTasks()}
              className="ew-button-ghost inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm"
            >
              <RefreshCw className="size-4" />
              刷新
            </button>
            <button
              onClick={openCreateModal}
              className="ew-button-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm"
            >
              <Plus className="size-4" />
              新建任务
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="ew-subtext py-12 text-center text-sm">加载中...</div>
          ) : taskItems.length === 0 ? (
            <div className="py-16 text-center">
              <p className="ew-text text-base font-medium">还没有定时任务</p>
              <p className="ew-subtext mt-1 text-sm">点击右上角新建一个 Cron 任务</p>
            </div>
          ) : (
            <div className="space-y-3">
              {taskItems.map((task) => (
                <div key={task.id} className="rounded-xl border border-border">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-[220px] flex-1">
                      <div className="ew-text text-sm font-medium">{task.name}</div>
                      <div className="ew-subtext mt-1 text-xs">
                        Cron: <code>{task.cronExpr}</code> | TZ: <code>{task.timezone}</code>
                      </div>
                    </div>

                    <div className="flex min-w-[200px] items-center gap-2 text-xs">
                      <span className={cn('rounded px-2 py-1', statusBadgeClass(task.breakerState))}>
                        熔断: {task.breakerState}
                      </span>
                      {task.autoDisabledByBreaker && (
                        <span className="rounded bg-red-100 px-2 py-1 text-red-700">自动禁用</span>
                      )}
                    </div>

                    <div className="ew-subtext min-w-[220px] text-xs">
                      <div>下次运行: {toLocalTimeLabel(task.nextRunAt)}</div>
                      <div>最近运行: {toLocalTimeLabel(task.lastRunAt)}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        onClick={() => void handleToggleEnabled(task)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                          task.enabled ? 'bg-emerald-100 text-emerald-700' : 'ew-button-ghost'
                        )}
                      >
                        {task.enabled ? '已启用' : '已停用'}
                      </button>
                      <button
                        onClick={() => void handleRunNow(task.id)}
                        className="ew-button-ghost inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                      >
                        <Play className="size-3.5" />
                        立即执行
                      </button>
                      <button
                        onClick={() => void handleToggleRuns(task.id)}
                        className="ew-button-ghost inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                      >
                        <History className="size-3.5" />
                        运行历史
                      </button>
                      <button
                        onClick={() => void handleResetBreaker(task.id)}
                        className="ew-button-ghost inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                      >
                        <ShieldAlert className="size-3.5" />
                        重置熔断
                      </button>
                      <button
                        onClick={() => openEditModal(task)}
                        className="ew-button-ghost rounded-md px-2 py-1 text-xs"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => void handleDeleteScheduledTask(task.id)}
                        className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {expandedTaskId === task.id && (
                    <div className="border-t border-border px-4 py-3">
                      {runsLoading ? (
                        <div className="ew-subtext text-xs">加载运行历史中...</div>
                      ) : taskRuns.length === 0 ? (
                        <div className="ew-subtext text-xs">暂无运行历史</div>
                      ) : (
                        <div className="overflow-auto">
                          <table className="w-full min-w-[760px] text-left text-xs">
                            <thead>
                              <tr className="ew-subtext border-b border-border">
                                <th className="px-2 py-2">开始时间</th>
                                <th className="px-2 py-2">触发方式</th>
                                <th className="px-2 py-2">状态</th>
                                <th className="px-2 py-2">耗时</th>
                                <th className="px-2 py-2">错误</th>
                                <th className="px-2 py-2">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {taskRuns.map((run) => (
                                <tr key={run.id} className="border-b border-border/60">
                                  <td className="px-2 py-2">{toLocalTimeLabel(run.startedAt)}</td>
                                  <td className="px-2 py-2">{run.triggerType}</td>
                                  <td className="px-2 py-2">{run.status}</td>
                                  <td className="px-2 py-2">{formatDuration(run.durationMs)}</td>
                                  <td className="px-2 py-2 text-red-600">
                                    {run.errorCode || run.errorMessage || '-'}
                                  </td>
                                  <td className="px-2 py-2">
                                    <button
                                      onClick={() => openRunDetail(run, task.name)}
                                      className="ew-button-ghost rounded-md px-2 py-1 text-xs"
                                    >
                                      详情
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {runDetailOpen && (
        <div className="fixed inset-0 z-40 bg-black/35" onClick={closeRunDetail}>
          <aside
            className="ew-main-panel absolute inset-y-0 right-0 w-full max-w-2xl border-l border-border"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="ew-title text-base font-semibold">运行详情</h2>
                <div className="ew-subtext mt-1 text-xs">
                  {runDetailTaskName || runDetail?.taskId || '-'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {runDetail && (
                  <button
                    onClick={() => void loadRunDetail(runDetail.id)}
                    className="ew-button-ghost inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
                  >
                    <RefreshCw className={cn('size-3.5', runDetailLoading ? 'animate-spin' : '')} />
                    刷新
                  </button>
                )}
                <button onClick={closeRunDetail} className="ew-icon-btn rounded-lg p-2">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-64px)] space-y-4 overflow-auto px-5 py-4">
              {runDetailLoading && !runDetail ? (
                <div className="ew-subtext text-sm">加载运行详情中...</div>
              ) : runDetail ? (
                <>
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 text-sm md:grid-cols-2">
                    <div>
                      <div className="ew-subtext text-xs">运行ID</div>
                      <div className="font-mono text-xs ew-text">{runDetail.id}</div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">会话ID</div>
                      <div className="font-mono text-xs ew-text">{runDetail.sessionId || '-'}</div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">触发方式</div>
                      <div className="ew-text">{runDetail.triggerType}</div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">状态</div>
                      <div className={cn('font-medium', runDetail.status === 'failed' || runDetail.status === 'timeout' ? 'text-red-600' : 'ew-text')}>
                        {runDetail.status}
                      </div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">开始时间</div>
                      <div className="ew-text">{toLocalTimeLabel(runDetail.startedAt)}</div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">结束时间</div>
                      <div className="ew-text">{toLocalTimeLabel(runDetail.finishedAt)}</div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">计划触发时间</div>
                      <div className="ew-text">{toLocalTimeLabel(runDetail.scheduledAt)}</div>
                    </div>
                    <div>
                      <div className="ew-subtext text-xs">耗时</div>
                      <div className="ew-text">{formatDuration(runDetail.durationMs)}</div>
                    </div>
                  </div>

                  {(runDetail.errorCode || runDetail.errorMessage) && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      <div className="font-medium">错误摘要</div>
                      <div className="mt-1 font-mono text-xs">
                        {runDetail.errorCode || '-'}
                        {runDetail.errorMessage ? `: ${runDetail.errorMessage}` : ''}
                      </div>
                    </div>
                  )}

                  {runDetail.status === 'running' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      任务仍在运行，详情每 2 秒自动刷新。
                    </div>
                  )}

                  {runResult?.finalOutput && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-medium text-emerald-800">最终输出</div>
                        <div className="text-[11px] text-emerald-700">
                          来源: {runResult.source === 'result' ? 'result' : 'assistant_text'}
                        </div>
                      </div>
                      <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-emerald-200 bg-white p-3 text-xs text-emerald-900">
                        {runResult.finalOutput}
                      </pre>
                    </div>
                  )}

                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="ew-text text-sm font-medium">过程时间线</div>
                      <div className="ew-subtext text-xs">{runTimeline.length} 条</div>
                    </div>
                    {runTimeline.length === 0 ? (
                      <div className="ew-subtext text-xs">暂无过程时间线</div>
                    ) : (
                      <div className="space-y-2">
                        {runTimeline.map((item, index) => (
                          <div key={`${item.at}_${index}`} className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                            <div className="text-xs ew-text">
                              {toLocalTimeLabel(item.at)} · {item.event}
                            </div>
                            {item.detail && (
                              <div className="ew-subtext mt-1 text-xs break-all">{item.detail}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="ew-text text-sm font-medium">执行日志</div>
                      <div className="ew-subtext text-xs">{runLogs.length} 条</div>
                    </div>
                    {runLogs.length === 0 ? (
                      <div className="ew-subtext text-xs">暂无日志（该运行可能由旧版本执行）</div>
                    ) : (
                      <div className="max-h-[260px] overflow-auto rounded-md border border-border/70 bg-muted/20 p-3 font-mono text-xs">
                        {runLogs.map((entry, index) => (
                          <div key={`${entry.at}_${index}`} className={cn('whitespace-pre-wrap break-all', entry.level === 'error' ? 'text-red-600' : 'ew-text')}>
                            [{toLocalTimeLabel(entry.at)}] [{entry.level}] {entry.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {runStats && (
                    <div className="rounded-lg border border-border p-3 text-xs">
                      <div className="ew-text font-medium">运行统计</div>
                      <div className="ew-subtext mt-1">
                        消息 {runStats.messageCount} · tool_use {runStats.toolUseCount} · tool_result {runStats.toolResultCount} · 错误 {runStats.errorCount}
                      </div>
                      {(runStats.timelineTruncated || runStats.logsTruncated) && (
                        <div className="mt-1 text-amber-700">
                          已触发采样上限：{runStats.timelineTruncated ? '时间线' : ''}
                          {runStats.timelineTruncated && runStats.logsTruncated ? '、' : ''}
                          {runStats.logsTruncated ? '日志' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="ew-subtext text-sm">暂无运行详情</div>
              )}

              {runDetailError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {runDetailError}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="ew-main-panel max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="ew-title text-base font-semibold">
                {editingTaskId ? '编辑定时任务' : '新建定时任务'}
              </h2>
              <button onClick={closeFormModal} className="ew-icon-btn rounded-lg p-2">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="ew-subtext text-xs">任务名</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                    placeholder="工作日早报"
                  />
                </label>
                <label className="space-y-1">
                  <span className="ew-subtext text-xs">Cron</span>
                  <input
                    value={form.cronExpr}
                    onChange={(e) => setForm((prev) => ({ ...prev, cronExpr: e.target.value }))}
                    className="ew-input h-10 w-full rounded-lg px-3 font-mono text-sm"
                    placeholder="0 9 * * 1-5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="ew-subtext text-xs">时区</span>
                  <input
                    value={form.timezone}
                    onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                    placeholder="Asia/Shanghai"
                  />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                  />
                  创建后启用
                </label>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="ew-text inline-flex items-center gap-1 text-sm font-medium">
                    <Clock3 className="size-4" />
                    Cron 效果解释
                  </span>
                  <button
                    onClick={() => void refreshCronPreview()}
                    className="ew-button-ghost rounded px-2 py-1 text-xs"
                  >
                    刷新解释
                  </button>
                </div>
                {previewLoading ? (
                  <div className="ew-subtext text-xs">解析中...</div>
                ) : previewError ? (
                  <div className="text-xs text-red-600">{previewError}</div>
                ) : cronDescription ? (
                  <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {cronDescription}
                  </div>
                ) : (
                  <div className="ew-subtext text-xs">输入 Cron 后会显示可读解释</div>
                )}
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-1 text-sm font-medium ew-text">
                  <WandSparkles className="size-4" />
                  诉求转 Cron
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  <input
                    value={nlCronText}
                    onChange={(e) => setNlCronText(e.target.value)}
                    placeholder="例如：工作日早上9点执行"
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                  />
                  <button
                    onClick={() => void handleSuggestCronFromText()}
                    disabled={nlCronLoading}
                    className="ew-button-ghost h-10 shrink-0 rounded-lg px-3 text-sm disabled:opacity-70"
                  >
                    {nlCronLoading ? '转换中...' : '转换'}
                  </button>
                </div>
                {nlCronError && (
                  <div className="mt-2 text-xs text-red-600">{nlCronError}</div>
                )}
                {nlCronSuggestions.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {nlCronSuggestions.map((item) => (
                      <button
                        key={item.expr}
                        onClick={() => applySuggestedCron(item.expr)}
                        className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-muted/30"
                        title="点击采用该表达式"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs ew-text">{item.expr}</code>
                          <span className={cn(
                            'rounded px-1.5 py-0.5 text-[11px]',
                            item.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          )}>
                            {item.confidence === 'high' ? '高置信度' : '中置信度'}
                          </span>
                        </div>
                        <div className="ew-subtext mt-1 text-xs">{item.description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="space-y-1">
                <span className="ew-subtext text-xs">用户指令（source prompt）</span>
                <textarea
                  value={form.sourcePrompt}
                  onChange={(e) => setForm((prev) => ({ ...prev, sourcePrompt: e.target.value }))}
                  className="ew-input min-h-[100px] w-full rounded-lg px-3 py-2 text-sm"
                  placeholder="例如：总结昨日销售数据并生成晨报"
                />
              </label>

              <label className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="ew-subtext text-xs">已确认 Plan（JSON）</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleSuggestPlan()}
                      disabled={planSuggestLoading}
                      className="ew-button-ghost rounded px-2 py-1 text-xs disabled:opacity-70"
                      title="根据用户指令自动生成推荐 Plan"
                    >
                      {planSuggestLoading ? '推荐中...' : '系统推荐Plan'}
                    </button>
                    <button
                      onClick={() => setForm((prev) => ({ ...prev, approvedPlanJson: formatPlanJson(null) }))}
                      className="ew-button-ghost rounded px-2 py-1 text-xs"
                    >
                      重置模板
                    </button>
                  </div>
                </div>
                <textarea
                  value={form.approvedPlanJson}
                  onChange={(e) => setForm((prev) => ({ ...prev, approvedPlanJson: e.target.value }))}
                  className="ew-input min-h-[190px] w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
                {planSuggestError && (
                  <div className="text-xs text-red-600">{planSuggestError}</div>
                )}
              </label>

              <label className="space-y-1">
                <span className="ew-subtext text-xs">执行 Prompt 快照（可选，留空由后端自动生成）</span>
                <textarea
                  value={form.executionPromptSnapshot}
                  onChange={(e) => setForm((prev) => ({ ...prev, executionPromptSnapshot: e.target.value }))}
                  className="ew-input min-h-[100px] w-full rounded-lg px-3 py-2 font-mono text-xs"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <span className="ew-subtext text-xs">失败阈值</span>
                  <input
                    value={form.maxConsecutiveFailures}
                    onChange={(e) => setForm((prev) => ({ ...prev, maxConsecutiveFailures: e.target.value }))}
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="ew-subtext text-xs">冷却秒数</span>
                  <input
                    value={form.cooldownSeconds}
                    onChange={(e) => setForm((prev) => ({ ...prev, cooldownSeconds: e.target.value }))}
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="ew-subtext text-xs">超时秒数</span>
                  <input
                    value={form.timeoutSeconds}
                    onChange={(e) => setForm((prev) => ({ ...prev, timeoutSeconds: e.target.value }))}
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="ew-text inline-flex items-center gap-1 text-sm font-medium">
                    <Clock3 className="size-4" />
                    未来 5 次触发预览
                  </span>
                  <button
                    onClick={() => void refreshCronPreview()}
                    className="ew-button-ghost rounded px-2 py-1 text-xs"
                  >
                    重新计算
                  </button>
                </div>
                {previewLoading ? (
                  <div className="ew-subtext text-xs">计算中...</div>
                ) : previewError ? (
                  <div className="text-xs text-red-600">{previewError}</div>
                ) : previewRuns.length === 0 ? (
                  <div className="ew-subtext text-xs">暂无预览结果</div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {previewRuns.map((iso) => (
                      <li key={iso} className="ew-subtext">
                        {new Date(iso).toLocaleString('zh-CN', { hour12: false })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {formError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {formError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={closeFormModal} className="ew-button-ghost rounded-lg px-3 py-2 text-sm">
                取消
              </button>
              <button
                onClick={() => void handleSubmitForm()}
                disabled={saving}
                className="ew-button-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm disabled:opacity-70"
              >
                {saving ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存任务
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

async function apiFetchPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetchRaw(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || `HTTP ${response.status}`)
  }

  return response.json()
}

export function ScheduledTasksPage() {
  return <ScheduledTasksContent />
}
