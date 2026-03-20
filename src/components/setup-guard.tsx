import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { api } from '@/shared/api'
import { cn } from '@/shared/lib/utils'

interface DependencyStatus {
  success: boolean
  claudeCode: boolean
  providers: number
  providerConfigured: boolean
  activeProvider: boolean
}

interface SetupGuardProps {
  children: ReactNode
}

type GuardState = 'checking' | 'ready' | 'blocked'

export function SetupGuard({ children }: SetupGuardProps) {
  const [state, setState] = useState<GuardState>('checking')
  const [status, setStatus] = useState<DependencyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)

  const checkDependencies = useCallback(async () => {
    setState('checking')
    setError(null)

    try {
      const result = await api.get<DependencyStatus>('/api/health/dependencies')
      setStatus(result)

      const ready = result.claudeCode && result.providerConfigured && result.activeProvider
      setState(ready ? 'ready' : 'blocked')
    } catch (err) {
      setError(err instanceof Error ? err.message : '环境检查失败')
      setState('blocked')
    }
  }, [])

  useEffect(() => {
    if (!skipped) {
      checkDependencies()
    }
  }, [checkDependencies, skipped])

  if (state === 'checking' && !skipped) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-950">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <Loader2 className="size-4 animate-spin text-orange-500" />
          <span>正在检查运行环境...</span>
        </div>
      </div>
    )
  }

  if ((state === 'blocked' && !skipped) || error) {
    const checks = [
      { label: 'Claude Code 已安装', ok: status?.claudeCode ?? false },
      { label: '已配置至少一个 Provider', ok: status?.providerConfigured ?? false },
      { label: '已选择当前启用 Provider', ok: status?.activeProvider ?? false },
    ]

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-gray-950">
        <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl bg-orange-100 p-2 dark:bg-orange-900/40">
              <Wrench className="size-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">环境尚未准备完成</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                先完成基础配置，再开始任务会更稳定。
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
            {checks.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-300">{item.label}</span>
                <span
                  className={cn(
                    'rounded px-2 py-0.5 text-xs font-medium',
                    item.ok
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  )}
                >
                  {item.ok ? '已就绪' : '待配置'}
                </span>
              </div>
            ))}
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={checkDependencies}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <RefreshCw className="size-4" />
              重新检查
            </button>
            <button
              onClick={() => setSkipped(true)}
              className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              仍然进入应用
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
