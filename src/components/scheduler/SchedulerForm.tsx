/**
 * Scheduler Form - 创建/编辑定时任务表单
 */

import { useState, useEffect } from 'react'
import { X, Loader2, Calendar, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface CronSuggestion {
  expr: string
  description: string
  upcomingRuns: string[]
}

interface SchedulerFormProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  taskId?: string
}

export function SchedulerForm({ isOpen, onClose, onSuccess, taskId }: SchedulerFormProps) {
  const [name, setName] = useState('')
  const [cronExpr, setCronExpr] = useState('0 9 * * *')
  const [sourcePrompt, setSourcePrompt] = useState('')
  const [cronDescription, setCronDescription] = useState('')
  const [upcomingRuns, setUpcomingRuns] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<CronSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState<any>(null)

  useEffect(() => {
    if (isOpen && cronExpr) {
      explainCron(cronExpr)
    }
  }, [isOpen, cronExpr])

  const explainCron = async (expr: string) => {
    try {
      const response = await fetch(`/api/scheduled-tasks/cron/explain?expr=${encodeURIComponent(expr)}`)
      if (!response.ok) return
      const data = await response.json()
      setCronDescription(data.description || '')

      const previewResponse = await fetch(`/api/scheduled-tasks/cron/preview?expr=${encodeURIComponent(expr)}&count=5`)
      if (previewResponse.ok) {
        const previewData = await previewResponse.json()
        setUpcomingRuns(previewData.upcomingRuns || [])
      }
    } catch (err) {
      console.error('Failed to explain cron:', err)
    }
  }

  const handleSuggestCron = async () => {
    if (!sourcePrompt.trim()) return

    try {
      const response = await fetch('/api/scheduled-tasks/cron/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourcePrompt }),
      })
      if (!response.ok) throw new Error('Failed to suggest cron')
      const data = await response.json()
      setSuggestions(data.suggestions || [])
    } catch (err) {
      console.error('Failed to suggest cron:', err)
    }
  }

  const handleGeneratePlan = async () => {
    if (!sourcePrompt.trim()) return

    setPlanLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/scheduled-tasks/plan/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: sourcePrompt }),
      })
      if (!response.ok) throw new Error('Failed to generate plan')
      const data = await response.json()
      setGeneratedPlan(data.plan)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan')
    } finally {
      setPlanLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!generatedPlan) {
      setError('请先生成执行计划')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          enabled: true,
          cronExpr,
          timezone: 'Asia/Shanghai',
          sourcePrompt,
          approvedPlan: generatedPlan,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create task')
      }

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="ew-card flex h-[85vh] w-[90vw] max-w-3xl flex-col rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">创建定时任务</h2>
          <button onClick={onClose} className="ew-icon-btn rounded-lg p-2">
            <X className="size-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {/* Task Name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">任务名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="例如：每日数据备份"
                required
              />
            </div>

            {/* Source Prompt */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">任务描述</label>
              <textarea
                value={sourcePrompt}
                onChange={(e) => setSourcePrompt(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="描述你希望定时执行的任务..."
                rows={4}
                required
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleSuggestCron}
                  className="text-sm text-primary hover:underline"
                >
                  根据描述建议 Cron 表达式
                </button>
                <button
                  type="button"
                  onClick={handleGeneratePlan}
                  disabled={planLoading}
                  className="flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {planLoading && <Loader2 className="size-3 animate-spin" />}
                  生成执行计划
                </button>
              </div>
            </div>

            {/* Cron Suggestions */}
            {suggestions.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-2 text-sm font-medium">建议的 Cron 表达式：</p>
                <div className="space-y-2">
                  {suggestions.map((sug, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setCronExpr(sug.expr)
                        setSuggestions([])
                      }}
                      className="w-full rounded border border-border bg-background p-2 text-left text-sm hover:bg-muted/50"
                    >
                      <div className="font-mono">{sug.expr}</div>
                      <div className="text-xs text-muted-foreground">{sug.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cron Expression */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Cron 表达式</label>
              <input
                type="text"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                placeholder="0 9 * * *"
                required
              />
              {cronDescription && (
                <p className="mt-1 text-xs text-muted-foreground">{cronDescription}</p>
              )}
              {upcomingRuns.length > 0 && (
                <div className="mt-2 rounded border border-border bg-muted/30 p-2">
                  <p className="mb-1 text-xs font-medium">接下来 5 次运行时间：</p>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {upcomingRuns.map((run, idx) => (
                      <li key={idx}>{new Date(run).toLocaleString('zh-CN')}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Generated Plan */}
            {generatedPlan && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
                <p className="mb-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  ✓ 执行计划已生成
                </p>
                <div className="text-xs text-emerald-600 dark:text-emerald-400">
                  <p className="font-medium">{generatedPlan.goal}</p>
                  <ul className="mt-1 space-y-0.5">
                    {generatedPlan.steps?.map((step: any, idx: number) => (
                      <li key={idx}>• {step.description}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm hover:bg-muted"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !generatedPlan}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              创建任务
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
