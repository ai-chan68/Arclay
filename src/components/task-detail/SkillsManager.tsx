/**
 * Skills Manager - Skill 管理组件
 *
 * 功能：
 * - 显示已安装的 skills 列表
 * - 按提供商（Claude/Codex/Gemini）启用/禁用
 * - 导入 skill
 * - 删除 skill
 */

import { useState, useEffect } from 'react'
import { Download, Trash2, Search, Plus, BookOpen, FolderOpen, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/api'
import { getFileSystem } from '@/shared/fs'
import { isTauri } from 'shared-types'
// Skill 信息
interface SkillInfo {
  id: string
  name: string
  description: string
  source: 'project'
  path: string
  metadata?: {
    name: string
    description: string
    license?: string
    compatibility?: string
    official?: boolean
    metadata?: {
      author?: string
      version?: string
      generatedBy?: string
    }
  }
}

type SkillHealthStatus = 'healthy' | 'warning' | 'broken'

// Skill 提供商配置
interface SkillProviderConfig {
  claude: boolean
  codex: boolean
  gemini: boolean
}

// 单个 Skill 的配置
interface SkillItemConfig {
  enabled: boolean
  providers: SkillProviderConfig
}

// Skill 统计
interface SkillsStats {
  total: number
  project: number
}

interface SkillsManagerProps {
  globalEnabled: boolean
  skillsConfig?: Record<string, SkillItemConfig>
  onConfigChange: (config: Record<string, SkillItemConfig>) => void
}

export function SkillsManager({ globalEnabled, skillsConfig = {}, onConfigChange }: SkillsManagerProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [stats, setStats] = useState<SkillsStats>({ total: 0, project: 0 })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [skillHealthMap, setSkillHealthMap] = useState<Record<string, SkillHealthStatus>>({})
  const [skillActionMap, setSkillActionMap] = useState<Record<string, 'health' | 'update' | 'repair'>>({})

  // 显示消息
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  // 加载 skills 列表
  const loadSkills = async () => {
    try {
      setLoading(true)
      const response = await api.get<{ skills: SkillInfo[]; stats: SkillsStats }>('/api/settings/skills/list')
      setSkills(response.skills)
      setStats(response.stats)
    } catch (err) {
      console.error('Failed to load skills:', err)
      showMessage('error', '无法加载 Skills 列表')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSkills()
  }, [])

  // 获取 skill 的当前配置
  const getSkillConfig = (skillId: string): SkillItemConfig => {
    return skillsConfig[skillId] || {
      enabled: true,
      providers: { claude: true, codex: false, gemini: false },
    }
  }

  // 更新 skill 配置
  const updateSkillConfig = (skillId: string, updates: Partial<SkillItemConfig> | Partial<SkillProviderConfig>) => {
    const currentConfig = getSkillConfig(skillId)

    // 检查是否是 providers 更新
    if ('claude' in updates || 'codex' in updates || 'gemini' in updates) {
      const newConfig: SkillItemConfig = {
        ...currentConfig,
        providers: {
          ...currentConfig.providers,
          ...(updates as SkillProviderConfig),
        },
      }
      onConfigChange({
        ...skillsConfig,
        [skillId]: newConfig,
      })
    } else {
      const newConfig: SkillItemConfig = {
        ...currentConfig,
        ...(updates as Partial<SkillItemConfig>),
      }
      onConfigChange({
        ...skillsConfig,
        [skillId]: newConfig,
      })
    }
  }

  // 切换 skill 全局启用状态
  const toggleSkillEnabled = (skillId: string) => {
    const config = getSkillConfig(skillId)
    updateSkillConfig(skillId, { enabled: !config.enabled })
  }

  // 切换提供商启用状态
  const toggleProvider = (skillId: string, provider: keyof SkillProviderConfig) => {
    const config = getSkillConfig(skillId)
    updateSkillConfig(skillId, {
      [provider]: !config.providers[provider],
    })
  }

  // 删除 skill
  const handleDeleteSkill = async (skill: SkillInfo) => {
    if (!confirm(`确定要删除 Skill "${skill.name}" 吗？此操作不可恢复。`)) {
      return
    }

    try {
      // 调用 API 删除 skill
      await api.delete(`/api/settings/skills/${encodeURIComponent(skill.id)}`)
      showMessage('success', `Skill "${skill.name}" 已删除`)
      loadSkills()
    } catch (err) {
      console.error('Failed to delete skill:', err)
      showMessage('error', err instanceof Error ? err.message : '无法删除 Skill')
    }
  }

  const setSkillActionLoading = (skillId: string, action?: 'health' | 'update' | 'repair') => {
    setSkillActionMap((prev) => {
      const next = { ...prev }
      if (!action) {
        delete next[skillId]
      } else {
        next[skillId] = action
      }
      return next
    })
  }

  const handleSkillHealthCheck = async (skill: SkillInfo) => {
    try {
      setSkillActionLoading(skill.id, 'health')
      const response = await api.get<{
        success: boolean
        status: SkillHealthStatus
      }>(`/api/settings/skills/${encodeURIComponent(skill.id)}/health`)
      setSkillHealthMap((prev) => ({
        ...prev,
        [skill.id]: response.status,
      }))
      showMessage('success', `Skill "${skill.name}" 健康状态: ${response.status}`)
    } catch (err) {
      console.error('Failed to check skill health:', err)
      showMessage('error', err instanceof Error ? err.message : '健康检查失败')
    } finally {
      setSkillActionLoading(skill.id)
    }
  }

  const handleSkillUpdate = async (skill: SkillInfo) => {
    try {
      setSkillActionLoading(skill.id, 'update')
      await api.post(`/api/settings/skills/${encodeURIComponent(skill.id)}/update`, {})
      showMessage('success', `Skill "${skill.name}" 已更新`)
      await loadSkills()
    } catch (err) {
      console.error('Failed to update skill:', err)
      showMessage('error', err instanceof Error ? err.message : '更新失败')
    } finally {
      setSkillActionLoading(skill.id)
    }
  }

  const handleSkillRepair = async (skill: SkillInfo) => {
    try {
      setSkillActionLoading(skill.id, 'repair')
      await api.post(`/api/settings/skills/${encodeURIComponent(skill.id)}/repair`, {})
      showMessage('success', `Skill "${skill.name}" 已修复`)
      await loadSkills()
    } catch (err) {
      console.error('Failed to repair skill:', err)
      showMessage('error', err instanceof Error ? err.message : '修复失败')
    } finally {
      setSkillActionLoading(skill.id)
    }
  }

  // 过滤 skills
  const filteredSkills = skills.filter((skill) => {
    const query = searchQuery.toLowerCase()
    return (
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query)
    )
  })

  // 所有 skills 都是项目级
  const projectSkills = filteredSkills

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ui-accent)] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 统计信息 */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-[color:color-mix(in_oklab,var(--ui-panel-2)_76%,transparent)] px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="ew-subtext">
            已安装: <span className="ew-text font-medium">{stats.total}</span>
          </span>
          <span className="ew-subtext">·</span>
          <span className="ew-subtext">
            项目级: <span className="ew-text font-medium">{stats.project}</span>
          </span>
        </div>
      </div>

      {/* 搜索和导入 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="ew-subtext absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索 Skills..."
            className="ew-input w-full rounded-lg py-2 pl-9 pr-4 text-sm"
          />
        </div>
        <button
          onClick={() => setShowImportModal(true)}
          className="ew-button-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
        >
          <Download className="size-4" />
          导入已有
        </button>
      </div>

      {/* Skills 列表 */}
      <div className="space-y-3">
        {projectSkills.length > 0 && (
          <div>
            <h4 className="ew-subtext mb-2 text-xs font-medium uppercase">
              项目级 Skills (SKILLs/)
            </h4>
            <div className="space-y-2">
              {projectSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  config={getSkillConfig(skill.id)}
                  globalEnabled={globalEnabled}
                  healthStatus={skillHealthMap[skill.id]}
                  actionLoading={skillActionMap[skill.id]}
                  onToggle={() => toggleSkillEnabled(skill.id)}
                  onToggleProvider={(provider) => toggleProvider(skill.id, provider)}
                  onHealthCheck={() => handleSkillHealthCheck(skill)}
                  onUpdate={() => handleSkillUpdate(skill)}
                  onRepair={() => handleSkillRepair(skill)}
                  onDelete={() => handleDeleteSkill(skill)}
                />
              ))}
            </div>
          </div>
        )}

        {filteredSkills.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <BookOpen className="ew-subtext mx-auto size-8" />
            <p className="ew-subtext mt-2 text-sm">
              {searchQuery ? '未找到匹配的 Skills' : '暂无已安装的 Skills'}
            </p>
            {!searchQuery && (
              <p className="ew-subtext mt-1 text-xs">
                点击上方"导入已有"按钮添加 Skills
              </p>
            )}
          </div>
        )}
      </div>

      {/* 导入 Modal */}
      {showImportModal && (
        <ImportSkillsModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false)
            loadSkills()
          }}
        />
      )}
    </div>
  )
}

// Skill 卡片组件
interface SkillCardProps {
  skill: SkillInfo
  config: SkillItemConfig
  globalEnabled: boolean
  healthStatus?: SkillHealthStatus
  actionLoading?: 'health' | 'update' | 'repair'
  onToggle: () => void
  onToggleProvider: (provider: keyof SkillProviderConfig) => void
  onHealthCheck: () => void
  onUpdate: () => void
  onRepair: () => void
  onDelete: () => void
}

function SkillCard({
  skill,
  config,
  globalEnabled,
  healthStatus,
  actionLoading,
  onToggle,
  onToggleProvider,
  onHealthCheck,
  onUpdate,
  onRepair,
  onDelete,
}: SkillCardProps) {
  const isEnabled = globalEnabled && config.enabled

  return (
    <div
      className={cn(
        'rounded-lg border bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)] transition-opacity',
        isEnabled
          ? 'border-border'
          : 'border-[color:color-mix(in_oklab,var(--ui-border)_58%,transparent)] bg-[color:color-mix(in_oklab,var(--ui-panel-2)_72%,transparent)] opacity-75'
      )}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ew-text text-sm font-medium">{skill.name}</h3>
              <span
                className={cn(
                  'ew-status-chip rounded px-1.5 py-0.5 text-xs'
                )}
                data-tone="success"
              >
                项目
              </span>
              {healthStatus && (
                <span
                  className={cn(
                    'ew-status-chip rounded px-1.5 py-0.5 text-xs'
                  )}
                  data-tone={
                    healthStatus === 'healthy'
                      ? 'success'
                      : healthStatus === 'warning'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {healthStatus}
                </span>
              )}
            </div>
            <p className="ew-subtext mt-1 line-clamp-2 break-words text-xs">
              {skill.description || '暂无描述'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={onToggle}
                disabled={!globalEnabled}
                className="peer sr-only"
              />
              <div
                className={cn(
                  'ew-switch-track peer',
                  config.enabled
                    ? ''
                    : '',
                  !globalEnabled && 'cursor-not-allowed opacity-50'
                )}
              />
            </label>

            <span
              className="sr-only"
            >
              toggle skill
            </span>
            <button
              onClick={onDelete}
              className="ew-subtext rounded p-1.5 hover:bg-[color:var(--ui-danger-soft)] hover:text-[color:var(--ui-danger)]"
              title="删除 Skill"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ProviderToggle
              label="Claude"
              enabled={isEnabled && config.providers.claude}
              onToggle={() => onToggleProvider('claude')}
              disabled={!globalEnabled}
            />
            <ProviderToggle
              label="Codex"
              enabled={isEnabled && config.providers.codex}
              onToggle={() => onToggleProvider('codex')}
              disabled={!globalEnabled}
            />
            <ProviderToggle
              label="Gemini"
              enabled={isEnabled && config.providers.gemini}
              onToggle={() => onToggleProvider('gemini')}
              disabled={!globalEnabled}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={onHealthCheck}
              disabled={actionLoading !== undefined}
              className="ew-subtext rounded px-2 py-1 text-xs hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_68%,transparent)] hover:text-[color:var(--ui-text)] disabled:opacity-50"
              title="健康检查"
            >
              {actionLoading === 'health' ? '检查中' : '健康检查'}
            </button>
            <button
              onClick={onUpdate}
              disabled={actionLoading !== undefined}
              className="ew-subtext rounded px-2 py-1 text-xs hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_68%,transparent)] hover:text-[color:var(--ui-text)] disabled:opacity-50"
              title="更新 Skill"
            >
              {actionLoading === 'update' ? '更新中' : '更新'}
            </button>
            <button
              onClick={onRepair}
              disabled={actionLoading !== undefined}
              className="ew-subtext rounded px-2 py-1 text-xs hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_68%,transparent)] hover:text-[color:var(--ui-text)] disabled:opacity-50"
              title="修复 Skill"
            >
              {actionLoading === 'repair' ? '修复中' : '修复'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 提供商开关组件
interface ProviderToggleProps {
  label: string
  enabled: boolean
  onToggle: () => void
  disabled?: boolean
}

function ProviderToggle({ label, enabled, onToggle, disabled }: ProviderToggleProps) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        enabled
          ? 'ew-status-chip'
          : 'bg-[color:color-mix(in_oklab,var(--ui-panel-2)_78%,transparent)] text-[color:var(--ui-subtext)]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      data-tone={enabled ? 'success' : undefined}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          enabled ? 'bg-[color:var(--ui-success)]' : 'bg-[color:var(--ui-subtext)]/70'
        )}
      />
      {label}
    </button>
  )
}

// 导入 Skills Modal
interface ImportSkillsModalProps {
  onClose: () => void
  onSuccess: () => void
}

function ImportSkillsModal({ onClose, onSuccess }: ImportSkillsModalProps) {
  const [importPath, setImportPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 显示消息
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleImport = async () => {
    if (!importPath.trim()) {
      showMessage('error', '请输入 Skill 目录路径')
      return
    }

    try {
      setLoading(true)
      await api.post('/api/settings/skills/import', { path: importPath.trim() })
      showMessage('success', 'Skill 已成功导入')
      onSuccess()
    } catch (err) {
      console.error('Failed to import skill:', err)
      showMessage('error', err instanceof Error ? err.message : '无法导入 Skill')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-[color:color-mix(in_oklab,var(--ui-panel)_94%,transparent)] p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="ew-text text-lg font-semibold">导入 Skill</h3>
          <button
            onClick={onClose}
            className="ew-subtext rounded-lg p-2 hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_68%,transparent)] hover:text-[color:var(--ui-text)]"
          >
            <X className="size-5" />
          </button>
        </div>

        <p className="ew-subtext mt-2 text-sm">
          输入包含 SKILL.md 文件的 Skill 目录路径
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="ew-text mb-1.5 block text-sm font-medium">
              Skill 目录路径
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                placeholder="例如: /path/to/my-skill"
                className="ew-input flex-1 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={async () => {
                  if (isTauri()) {
                    // Tauri 环境下使用原生文件选择器获取完整路径
                    try {
                      const fs = getFileSystem()
                      const selectedPath = await fs.pickDirectory()
                      if (selectedPath) {
                        setImportPath(selectedPath)
                      }
                    } catch (err) {
                      console.error('Failed to pick directory:', err)
                      showMessage('error', '无法选择目录')
                    }
                  } else {
                    // Web 环境下使用原生的文件选择（只能获取相对路径）
                    const input = document.createElement('input')
                    input.type = 'file'
                    // @ts-ignore - webkitdirectory is non-standard but widely supported
                    input.webkitdirectory = true
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files
                      if (files && files.length > 0) {
                        // 获取目录路径 - 使用 webkitRelativePath
                        const relativePath = files[0].webkitRelativePath
                        if (relativePath) {
                          // 获取完整目录路径（包含所有父目录）
                          const pathParts = relativePath.split('/')
                          // 移除文件名，保留目录路径
                          pathParts.pop()
                          const dirPath = pathParts.join('/')
                          setImportPath(dirPath)
                        }
                      }
                    }
                    input.click()
                  }
                }}
                className="ew-control ew-subtext flex items-center gap-1 rounded-lg px-3 py-2 text-sm hover:text-[color:var(--ui-text)]"
              >
                <FolderOpen className="size-4" />
                浏览
              </button>
            </div>
          </div>

          <div className="ew-subtext rounded-lg border border-border bg-[color:color-mix(in_oklab,var(--ui-panel-2)_76%,transparent)] p-3 text-xs">
            <p>导入的 Skill 将被复制到项目目录:</p>
            <p className="mt-1 font-mono text-[color:var(--ui-accent)]">SKILLs/</p>
            {!isTauri() && (
              <p className="mt-2 text-[color:var(--ui-warning)]">
                提示：由于浏览器安全限制，"浏览"按钮只能选择文件夹名称。
                请手动输入完整路径（如：/Users/xxx/SKILLs/canvas-design）
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="ew-text rounded-lg px-4 py-2 text-sm font-medium hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_68%,transparent)]"
          >
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={loading || !importPath.trim()}
            className={cn(
              'ew-button-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium',
              loading || !importPath.trim()
                ? 'cursor-not-allowed opacity-50'
                : ''
            )}
          >
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                导入中...
              </>
            ) : (
              <>
                <Plus className="size-4" />
                导入
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
