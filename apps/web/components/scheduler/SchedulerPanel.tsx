/**
 * Scheduler Panel - 定时任务管理面板
 */

import { useState, useEffect } from 'react'
import { X, Plus, Calendar, Clock, AlertCircle, CheckCircle, XCircle, Loader2, History } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { SchedulerForm } from './SchedulerForm'
import { SchedulerRunHistory } from './SchedulerRunHistory'

interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  cronExpr: string
  timezone: string
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: 'idle' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped'
  breakerState: 'closed' | 'open' | 'half_open'
  consecutiveFailures: number
  createdAt: number
  updatedAt: number
}

interface SchedulerPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SchedulerPanel({ isOpen, onClose }: SchedulerPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null)
  const [historyTaskName, setHistoryTaskName] = useState<string>('')

  useEffect(() => {
    if (isOpen) {
      loadTasks()
    }
  }, [isOpen])

  const loadTasks = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/scheduled-tasks')
      if (!response.ok) throw new Error('Failed to load tasks')
      const data = await response.json()
      setTasks(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleEnabled = async (taskId: string, enabled: boolean) => {
    try {
      const endpoint = enabled ? 'enable' : 'disable'
      const response = await fetch(`/api/scheduled-tasks/${taskId}/${endpoint}`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to toggle task')
      await loadTasks()
    } catch (err) {
      console.error('Toggle task failed:', err)
    }
  }

  const handleRunNow = async (taskId: string) => {
    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}/run-now`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to run task')
      await loadTasks()
    } catch (err) {
      console.error('Run task failed:', err)
    }
  }

  const handleDelete = async (taskId: string) => {
    if (!confirm('确定要删除这个定时任务吗？')) return
    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete task')
      await loadTasks()
    } catch (err) {
      console.error('Delete task failed:', err)
    }
  }

  const getBreakerStateIcon = (state: string) => {
    switch (state) {
      case 'closed':
        return <CheckCircle className="size-4 text-emerald-500" />
      case 'open':
        return <XCircle className="size-4 text-red-500" />
      case 'half_open':
        return <AlertCircle className="size-4 text-amber-500" />
      default:
        return null
    }
  }

  const formatNextRun = (timestamp: number | null) => {
    if (!timestamp) return '未设置'
    const date = new Date(timestamp)
    const now = new Date()
    const diff = date.getTime() - now.getTime()

    if (diff < 0) return '已过期'
    if (diff < 60000) return '即将运行'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟后`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时后`
    return date.toLocaleString('zh-CN')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="ew-card flex h-[80vh] w-[90vw] max-w-4xl flex-col rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Calendar className="size-5" />
            <h2 className="text-lg font-semibold">定时任务</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFormOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" />
              新建任务
            </button>
            <button
              onClick={onClose}
              className="ew-icon-btn rounded-lg p-2"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Calendar className="mb-4 size-12" />
              <p>暂无定时任务</p>
            </div>
          )}

          {!loading && !error && tasks.length > 0 && (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    'rounded-lg border border-border p-4 transition-colors',
                    task.enabled ? 'bg-card' : 'bg-muted/30'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {getBreakerStateIcon(task.breakerState)}
                        <h3 className="font-medium">{task.name}</h3>
                        {!task.enabled && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            已禁用
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="size-4" />
                          <span>{task.cronExpr}</span>
                        </div>
                        <div>
                          下次运行: {formatNextRun(task.nextRunAt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setHistoryTaskId(task.id)
                          setHistoryTaskName(task.name)
                        }}
                        className="flex items-center gap-1 rounded px-3 py-1 text-sm hover:bg-muted"
                      >
                        <History className="size-4" />
                        历史
                      </button>
                      <button
                        onClick={() => handleToggleEnabled(task.id, !task.enabled)}
                        className="rounded px-3 py-1 text-sm hover:bg-muted"
                      >
                        {task.enabled ? '禁用' : '启用'}
                      </button>
                      <button
                        onClick={() => handleRunNow(task.id)}
                        className="rounded px-3 py-1 text-sm hover:bg-muted"
                        disabled={!task.enabled}
                      >
                        立即运行
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="rounded px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <SchedulerForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={() => {
          setIsFormOpen(false)
          loadTasks()
        }}
      />
      {historyTaskId && (
        <SchedulerRunHistory
          isOpen={true}
          onClose={() => setHistoryTaskId(null)}
          taskId={historyTaskId}
          taskName={historyTaskName}
        />
      )}
    </div>
  )
}
