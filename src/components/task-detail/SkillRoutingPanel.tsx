import { useMemo, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { api } from '@/shared/api'
import { cn } from '@/shared/lib/utils'

export interface SkillRoutingSettings {
  mode: 'off' | 'assist' | 'auto'
  topN: number
  minScore: number
  llmRerank: boolean
  includeExplain: boolean
  fallback: 'all_enabled' | 'none'
}

interface RoutedSkill {
  skillId: string
  name: string
  score: number
  reasons: string[]
}

interface RoutePreviewResponse {
  success: boolean
  provider: string
  selected: RoutedSkill[]
  fallbackUsed: boolean
  candidates: number
  elapsedMs: number
}

interface SkillRoutingPanelProps {
  disabled?: boolean
  value?: SkillRoutingSettings
  onChange: (next: SkillRoutingSettings) => void
}

const DEFAULT_ROUTING: SkillRoutingSettings = {
  mode: 'assist',
  topN: 3,
  minScore: 0.35,
  llmRerank: false,
  includeExplain: true,
  fallback: 'all_enabled',
}

export function SkillRoutingPanel({ disabled, value, onChange }: SkillRoutingPanelProps) {
  const routing = useMemo(
    () => ({ ...DEFAULT_ROUTING, ...(value || {}) }),
    [value]
  )

  const [previewPrompt, setPreviewPrompt] = useState('')
  const [preview, setPreview] = useState<RoutePreviewResponse | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const update = (patch: Partial<SkillRoutingSettings>) => {
    onChange({
      ...routing,
      ...patch,
    })
  }

  const runPreview = async () => {
    const prompt = previewPrompt.trim()
    if (!prompt) {
      setPreviewError('请输入任务描述')
      return
    }
    try {
      setLoadingPreview(true)
      setPreviewError(null)
      const result = await api.post<RoutePreviewResponse>('/api/settings/skills/route/preview', {
        prompt,
      })
      setPreview(result)
    } catch (error) {
      setPreview(null)
      setPreviewError(error instanceof Error ? error.message : '预览失败')
    } finally {
      setLoadingPreview(false)
    }
  }

  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border border-border bg-[color:color-mix(in_oklab,var(--ui-panel)_76%,transparent)] p-4',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-[color:var(--ui-accent)]" />
        <h4 className="ew-text text-sm font-medium">Skill 自动路由</h4>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="ew-text mb-1 block text-xs font-medium">路由模式</label>
          <select
            disabled={disabled}
            value={routing.mode}
            onChange={(e) => update({ mode: e.target.value as SkillRoutingSettings['mode'] })}
            className="ew-select w-full rounded-lg px-3 py-2 text-sm"
          >
            <option value="off">关闭</option>
            <option value="assist">推荐</option>
            <option value="auto">自动应用</option>
          </select>
        </div>

        <div>
          <label className="ew-text mb-1 block text-xs font-medium">兜底策略</label>
          <select
            disabled={disabled}
            value={routing.fallback}
            onChange={(e) => update({ fallback: e.target.value as SkillRoutingSettings['fallback'] })}
            className="ew-select w-full rounded-lg px-3 py-2 text-sm"
          >
            <option value="all_enabled">路由失败时启用全部可用技能</option>
            <option value="none">路由失败时不选择技能</option>
          </select>
        </div>

        <div>
          <label className="ew-text mb-1 block text-xs font-medium">Top N</label>
          <input
            disabled={disabled}
            type="number"
            min={1}
            max={10}
            value={routing.topN}
            onChange={(e) => update({ topN: Math.max(1, Number(e.target.value) || 1) })}
            className="ew-input w-full rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="ew-text mb-1 block text-xs font-medium">最小分数 (0-1)</label>
          <input
            disabled={disabled}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={routing.minScore}
            onChange={(e) => {
              const valueNum = Number(e.target.value)
              const nextValue = Number.isFinite(valueNum) ? Math.min(1, Math.max(0, valueNum)) : 0
              update({ minScore: nextValue })
            }}
            className="ew-input w-full rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="ew-text flex items-center gap-2 text-sm">
          <input
            disabled={disabled}
            type="checkbox"
            checked={routing.includeExplain}
            onChange={(e) => update({ includeExplain: e.target.checked })}
            className="accent-[var(--ui-accent)]"
          />
          返回路由原因
        </label>
        <label className="ew-text flex items-center gap-2 text-sm">
          <input
            disabled={disabled}
            type="checkbox"
            checked={routing.llmRerank}
            onChange={(e) => update({ llmRerank: e.target.checked })}
            className="accent-[var(--ui-accent)]"
          />
          启用 LLM 重排（P1 预留）
        </label>
      </div>

      <div className="rounded-lg border border-border bg-[color:color-mix(in_oklab,var(--ui-panel-2)_78%,transparent)] p-3">
        <label className="ew-text mb-1 block text-xs font-medium">路由预览</label>
        <textarea
          disabled={disabled}
          value={previewPrompt}
          onChange={(e) => setPreviewPrompt(e.target.value)}
          placeholder="输入一句任务诉求，例如：帮我做一份 AI Agent 竞品调研报告"
          rows={3}
          className="ew-input w-full rounded-lg px-3 py-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            disabled={disabled || loadingPreview}
            onClick={runPreview}
            className={cn(
              'ew-button-primary inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium',
              (disabled || loadingPreview) && 'cursor-not-allowed opacity-60'
            )}
          >
            {loadingPreview ? <Loader2 className="size-3.5 animate-spin" /> : null}
            预览命中
          </button>
        </div>

        {previewError && (
          <div className="mt-2 rounded bg-[color:var(--ui-danger-soft)] px-2 py-1 text-xs text-[color:var(--ui-danger)]">
            {previewError}
          </div>
        )}

        {preview && (
          <div className="mt-3 space-y-2">
            <div className="ew-subtext text-xs">
              候选 {preview.candidates} 个 · 耗时 {preview.elapsedMs}ms · Provider: {preview.provider}
              {preview.fallbackUsed ? ' · 已触发兜底' : ''}
            </div>
            {preview.selected.length === 0 && (
              <div className="ew-subtext rounded bg-[color:color-mix(in_oklab,var(--ui-panel)_74%,transparent)] px-2 py-2 text-xs">
                未命中技能
              </div>
            )}
            {preview.selected.slice(0, 5).map((skill) => (
              <div
                key={skill.skillId}
                className="rounded border border-border bg-[color:color-mix(in_oklab,var(--ui-panel)_84%,transparent)] px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <div className="ew-text text-sm font-medium">{skill.name}</div>
                  <div className="text-xs text-[color:var(--ui-accent)]">{skill.score.toFixed(3)}</div>
                </div>
                {skill.reasons?.length > 0 && (
                  <div className="ew-subtext mt-1 text-xs">
                    {skill.reasons.slice(0, 2).join(' | ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
