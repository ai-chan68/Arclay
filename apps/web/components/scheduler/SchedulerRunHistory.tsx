/**
 * Scheduler Run History - 定时任务运行历史
 */

import { useState, useEffect } from 'react'
import { X, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface ScheduledTaskRun {
  id: string
  taskId: string
  triggerType: 'cron' | 'manual' | 'recovery_probe'
  scheduledAt: number | null
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'skipped'
  errorCode: string | null
  errorMessage: string | null
  durationMs: number | null
  sessionId: string | null
}

interface SchedulerRunHistoryProps {
  isOpen: boolean
  onClose: () => void
  taskId: string
  taskName: string
}

export function SchedulerRunHistory({ isOpen, onClose, taskId, taskName }: SchedulerRunHistoryProps) {
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && taskId) {
      loadRuns()
    }
  }, [isOpen, taskId])

  const loadRuns = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/scheduled-tasks/${taskId}/runs`)
      if (!response.ok) throw new Error('Failed to load runs')
      const data = await response.json()
      setRuns(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="size-4 text-emerald-500" />
      case 'failed':
        return <XCircle className="size-4 text-red-500" />
      case 'timeout':
        return <AlertCircle className="size-4 text-amber-500" />
      case 'running':
        return <Loader2 className="size-4 animate-spin text-blue-500" />
      default:
        return <Clock className="size-4 text-muted-foreground" />
    }
  }

  const getStatusText = (status: string) => {
    const map: Record<string, string> = {
      running: '运行中',
      success: '成功',
      failed: '失败',
      timeout: '超时',
      cancelled: '已取消',
      skipped: '已跳过',
    }
    return map[status] || status
  }

  const getTriggerTypeText = (type: string) => {
    const map: Record<string, string> = {
      cron: '定时触发',
      manual: '手动触发',
      recovery_probe: '恢复探测',
    }
    return map[type] || type
  }

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="ew-card flex h-[80vh] w-[90vw] max-w-4xl flex-col rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">运行历史</h2>
            <p className="text-sm text-muted-foreground">{taskName}</p>
          </div>
          <button onClick={onClose} className="ew-icon-btn rounded-lg p-2">
            <X className="size-5" />
          </button>
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

          {!loading && !error && runs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Clock className="mb-4 size-12" />
              <p>暂无运行记录</p>
            </div>
          )}

          {!loading && !error && runs.length > 0 && (
            <div className="space-y-3">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {getStatusIcon(run.status)}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{getStatusText(run.status)}</span>
                          <span className="text-xs text-muted-foreground">
                            {getTriggerTypeText(run.triggerType)}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          开始时间: {new Date(run.startedAt).toLocaleString('zh-CN')}
                        </div>
                        {run.finishedAt && (
                          <div className="text-sm text-muted-foreground">
                            耗时: {formatDuration(run.durationMs)}
                          </div>
                        )}
                        {run.errorMessage && (
                          <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                            {run.errorMessage}
                          </div>
                        )}
                      </div>
                    </div>
                    {run.sessionId && (
                      <button
                        onClick={() => window.open(`/task/${run.sessionId}`, '_blank')}
                        className="text-sm text-primary hover:underline"
                      >
                        查看详情
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
