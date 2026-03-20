import { useEffect, useState } from 'react'
import { Download, Plus, Trash2, RefreshCw } from 'lucide-react'
import { api } from '@/shared/api'
import { cn } from '@/shared/lib/utils'

type SkillSourceType = 'local' | 'git' | 'http'

interface SkillSourceConfig {
  id: string
  name: string
  type: SkillSourceType
  location: string
  branch?: string
  trusted: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface SkillSourcesPanelProps {
  disabled?: boolean
  onInstalled?: () => void
}

interface SourceListResponse {
  success: boolean
  sources: SkillSourceConfig[]
}

interface InstallResponse {
  success: boolean
  count: number
}

export function SkillSourcesPanel({ disabled, onInstalled }: SkillSourcesPanelProps) {
  const [sources, setSources] = useState<SkillSourceConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [installingSourceId, setInstallingSourceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [newSource, setNewSource] = useState({
    name: '',
    type: 'local' as SkillSourceType,
    location: '',
    trusted: true,
  })

  const loadSources = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.get<SourceListResponse>('/api/settings/skills/sources')
      setSources(data.sources || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载来源失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSources()
  }, [])

  const addSource = async () => {
    if (!newSource.name.trim() || !newSource.location.trim()) {
      setError('请输入来源名称与路径')
      return
    }
    try {
      setLoading(true)
      setError(null)
      await api.post('/api/settings/skills/sources', {
        name: newSource.name.trim(),
        type: newSource.type,
        location: newSource.location.trim(),
        trusted: newSource.trusted,
        enabled: true,
      })
      setNewSource({
        name: '',
        type: 'local',
        location: '',
        trusted: true,
      })
      setMessage('来源已添加')
      await loadSources()
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加来源失败')
    } finally {
      setLoading(false)
    }
  }

  const removeSource = async (sourceId: string) => {
    try {
      setLoading(true)
      setError(null)
      await api.delete(`/api/settings/skills/sources/${encodeURIComponent(sourceId)}`)
      setMessage('来源已删除')
      await loadSources()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除来源失败')
    } finally {
      setLoading(false)
    }
  }

  const installFromSource = async (sourceId: string) => {
    try {
      setInstallingSourceId(sourceId)
      setError(null)
      const result = await api.post<InstallResponse>('/api/settings/skills/install', { sourceId })
      setMessage(`安装完成，共 ${result.count} 个技能`)
      if (onInstalled) {
        onInstalled()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setInstallingSourceId(null)
    }
  }

  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border border-border bg-[color:color-mix(in_oklab,var(--ui-panel)_76%,transparent)] p-4',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-center justify-between">
        <h4 className="ew-text text-sm font-medium">技能来源管理</h4>
        <button
          onClick={loadSources}
          disabled={disabled || loading}
          className="ew-control ew-subtext inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:text-[color:var(--ui-text)] disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <input
          disabled={disabled}
          value={newSource.name}
          onChange={(e) => setNewSource((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="来源名称"
          className="ew-input rounded-lg px-3 py-2 text-sm"
        />
        <select
          disabled={disabled}
          value={newSource.type}
          onChange={(e) => setNewSource((prev) => ({ ...prev, type: e.target.value as SkillSourceType }))}
          className="ew-select rounded-lg px-3 py-2 text-sm"
        >
          <option value="local">local</option>
          <option value="git">git</option>
          <option value="http">http</option>
        </select>
        <input
          disabled={disabled}
          value={newSource.location}
          onChange={(e) => setNewSource((prev) => ({ ...prev, location: e.target.value }))}
          placeholder="本地路径 / git URL / zip URL"
          className="ew-input rounded-lg px-3 py-2 text-sm"
        />
        <button
          disabled={disabled || loading}
          onClick={addSource}
          className="ew-button-primary inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" />
          添加来源
        </button>
      </div>

      <label className="ew-text flex items-center gap-2 text-sm">
        <input
          disabled={disabled}
          type="checkbox"
          checked={newSource.trusted}
          onChange={(e) => setNewSource((prev) => ({ ...prev, trusted: e.target.checked }))}
          className="accent-[var(--ui-accent)]"
        />
        标记为 trusted（未信任来源不可安装）
      </label>

      <div className="space-y-2">
        {sources.length === 0 && (
          <div className="ew-subtext rounded border border-border bg-[color:color-mix(in_oklab,var(--ui-panel-2)_76%,transparent)] px-3 py-3 text-sm">
            暂无来源
          </div>
        )}
        {sources.map((source) => (
          <div
            key={source.id}
            className="rounded-lg border border-border bg-[color:color-mix(in_oklab,var(--ui-panel)_84%,transparent)] px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="ew-text text-sm font-medium">{source.name}</div>
                  <span className="ew-subtext rounded bg-[color:color-mix(in_oklab,var(--ui-panel-2)_82%,transparent)] px-1.5 py-0.5 text-xs">
                    {source.type}
                  </span>
                  {source.trusted ? (
                    <span className="ew-status-chip rounded px-1.5 py-0.5 text-xs" data-tone="success">
                      trusted
                    </span>
                  ) : (
                    <span className="ew-status-chip rounded px-1.5 py-0.5 text-xs" data-tone="warning">
                      untrusted
                    </span>
                  )}
                </div>
                <div className="ew-subtext mt-1 truncate text-xs">{source.location}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={disabled || !source.trusted || installingSourceId === source.id}
                  onClick={() => installFromSource(source.id)}
                  className="ew-button-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="size-3.5" />
                  {installingSourceId === source.id ? '安装中...' : '安装'}
                </button>
                <button
                  disabled={disabled || loading}
                  onClick={() => removeSource(source.id)}
                  className="ew-subtext rounded p-1.5 hover:bg-[color:var(--ui-danger-soft)] hover:text-[color:var(--ui-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                  title="删除来源"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {message && (
        <div className="ew-status-panel rounded px-3 py-2 text-xs" data-tone="success">
          {message}
        </div>
      )}
      {error && (
        <div className="ew-status-panel rounded px-3 py-2 text-xs" data-tone="danger">
          {error}
        </div>
      )}
    </div>
  )
}
