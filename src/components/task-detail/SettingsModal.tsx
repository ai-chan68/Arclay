/**
 * Settings Modal - 设置弹窗
 *
 * 支持标签页：
 * - Provider: LLM 提供商配置（多配置管理）
 * - MCP: MCP 服务器配置
 * - Skills: Skill 配置
 */

import { useState, useEffect } from 'react'
import {
  X,
  Plus,
  Trash2,
  Server,
  Palette,
  Cpu,
  BriefcaseBusiness,
  ShieldCheck,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Play,
  Edit2,
  Copy,
  GripVertical,
  Check,
  Activity,
  Loader2,
  RefreshCw,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/api'
import { renameMcpServerRecord, syncMcpNameDrafts } from '@/shared/lib/mcp-server-utils'
import { SkillsManager } from './SkillsManager'
import { SkillRoutingPanel, type SkillRoutingSettings } from './SkillRoutingPanel'
import { SkillSourcesPanel } from './SkillSourcesPanel'
import { useUITheme } from '@/shared/theme/ui-theme'

// MCP Server 配置
interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
}

// MCP 设置
interface McpSettings {
  enabled: boolean
  mcpServers: Record<string, McpServerConfig>
}

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

interface SkillSourceConfig {
  id: string
  name: string
  type: 'local' | 'git' | 'http'
  location: string
  branch?: string
  authRef?: string
  trusted: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
}

// Skill 设置
interface SkillSettings {
  enabled: boolean
  skills?: Record<string, SkillItemConfig>
  routing?: SkillRoutingSettings
  sources?: SkillSourceConfig[]
}

interface ApprovalSettings {
  enabled: boolean
  autoAllowTools: string[]
  timeoutMs: number
}

interface SandboxSettings {
  enabled: boolean
  provider?: 'native' | 'claude' | 'docker' | 'e2b'
  apiEndpoint?: string
  image?: string
}

// Provider 配置项
interface ProviderConfigItem {
  id: string
  name: string
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

// Settings 类型
interface Settings {
  activeProviderId: string | null
  providers: ProviderConfigItem[]
  mcp?: McpSettings
  skills?: SkillSettings
  approval?: ApprovalSettings
  sandbox?: SandboxSettings
}

interface DependencyStatus {
  success: boolean
  claudeCode: boolean
  providers: number
  providerConfigured: boolean
  activeProvider: boolean
}

// Provider 默认 baseUrl
const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  kimi: 'https://api.moonshot.cn/v1',
  deepseek: 'https://api.deepseek.com',
}

const PROVIDER_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  glm: ['glm-4-plus', 'glm-4-0520', 'glm-4', 'glm-4-air', 'glm-4-airx', 'glm-4-long', 'glm-4-flash'],
  openai: ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini', 'o3-mini'],
  openrouter: ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4', 'openai/gpt-5.2', 'openai/gpt-4o'],
  kimi: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  glm: 'GLM',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  kimi: 'Kimi',
  deepseek: 'DeepSeek',
}

const DEFAULT_SKILL_ROUTING: SkillRoutingSettings = {
  mode: 'assist',
  topN: 3,
  minScore: 0.35,
  llmRerank: false,
  includeExplain: true,
  fallback: 'all_enabled',
}

const DEFAULT_SKILL_SETTINGS: SkillSettings = {
  enabled: true,
  routing: DEFAULT_SKILL_ROUTING,
  sources: [],
}

const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  enabled: true,
  autoAllowTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'LS', 'LSP'],
  timeoutMs: 10 * 60 * 1000,
}

const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  enabled: false,
  provider: 'native',
  apiEndpoint: 'http://localhost:2026/api',
  image: '',
}

const APPROVAL_TOOL_OPTIONS: Array<{ name: string; desc: string }> = [
  { name: 'Read', desc: '读取文件内容' },
  { name: 'Glob', desc: '按模式搜索文件' },
  { name: 'Grep', desc: '文本内容检索' },
  { name: 'TodoWrite', desc: '更新执行计划' },
  { name: 'LS', desc: '列出目录内容' },
  { name: 'LSP', desc: '语言服务查询' },
  { name: 'Write', desc: '写入新文件' },
  { name: 'Edit', desc: '编辑文件内容' },
  { name: 'MultiEdit', desc: '批量编辑文件' },
  { name: 'Bash', desc: '执行 Shell 命令' },
  { name: 'WebSearch', desc: '联网搜索' },
  { name: 'WebFetch', desc: '拉取网页内容' },
]

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab = 'provider' | 'appearance' | 'sandbox' | 'mcp' | 'skills' | 'approval' | 'system'

// 编辑/添加 Provider 的表单状态
interface ProviderFormState {
  id?: string
  name: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
}

function StatusItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="ew-text">{label}</span>
      <span
        data-tone={ok ? 'success' : 'warning'}
        className={cn(
          'ew-status-chip rounded px-2 py-0.5 text-xs font-medium'
        )}
      >
        {ok ? '已就绪' : '待处理'}
      </span>
    </div>
  )
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useUITheme()
  const [activeTab, setActiveTab] = useState<SettingsTab>('provider')
  const [settings, setSettings] = useState<Settings>({
    activeProviderId: null,
    providers: [],
    mcp: { enabled: false, mcpServers: {} },
    skills: DEFAULT_SKILL_SETTINGS,
    approval: DEFAULT_APPROVAL_SETTINGS,
    sandbox: DEFAULT_SANDBOX_SETTINGS,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedMcpServer, setExpandedMcpServer] = useState<string | null>(null)
  const [mcpNameDrafts, setMcpNameDrafts] = useState<Record<string, string>>({})
  const [mcpDraft, setMcpDraft] = useState<McpSettings>({ enabled: false, mcpServers: {} })
  const [systemStatus, setSystemStatus] = useState<DependencyStatus | null>(null)
  const [systemLoading, setSystemLoading] = useState(false)
  const [skillsManagerReloadKey, setSkillsManagerReloadKey] = useState(0)

  // Provider 编辑/添加相关状态
  const [isEditingProvider, setIsEditingProvider] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [providerForm, setProviderForm] = useState<ProviderFormState>({
    name: '',
    provider: 'claude',
    apiKey: '',
    model: '',
    baseUrl: '',
  })

  // Provider 测试状态
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, {
    success: boolean
    error?: string
    details?: string
    latency?: number
    model?: string
  }>>({})

  useEffect(() => {
    if (isOpen) {
      loadSettings()
      loadSystemStatus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(null), 2400)
    return () => clearTimeout(timer)
  }, [success])

  useEffect(() => {
    const serverNames = Object.keys(mcpDraft.mcpServers || {})
    setMcpNameDrafts((previousDrafts) => syncMcpNameDrafts(serverNames, previousDrafts))
  }, [mcpDraft.mcpServers])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const data = await api.get<Settings>('/api/settings')
      setSettings({
        activeProviderId: data.activeProviderId || null,
        providers: data.providers || [],
        mcp: data.mcp || { enabled: false, mcpServers: {} },
        skills: {
          ...DEFAULT_SKILL_SETTINGS,
          ...(data.skills || {}),
          routing: {
            ...DEFAULT_SKILL_ROUTING,
            ...(data.skills?.routing || {}),
          },
          sources: data.skills?.sources || [],
        },
        approval: {
          ...DEFAULT_APPROVAL_SETTINGS,
          ...(data.approval || {}),
        },
        sandbox: {
          ...DEFAULT_SANDBOX_SETTINGS,
          ...(data.sandbox || {}),
        },
      })
      setMcpDraft(data.mcp || { enabled: false, mcpServers: {} })
    } catch (err) {
      console.error('Failed to load settings:', err)
      setError('加载设置失败')
    } finally {
      setLoading(false)
    }
  }

  const loadSystemStatus = async () => {
    try {
      setSystemLoading(true)
      const status = await api.get<DependencyStatus>('/api/health/dependencies')
      setSystemStatus(status)
    } catch (err) {
      console.error('Failed to load system status:', err)
      setError('读取系统状态失败')
    } finally {
      setSystemLoading(false)
    }
  }

  // 激活指定的 Provider
  const handleActivateProvider = async (providerId: string) => {
    try {
      setLoading(true)
      setError(null)
      await api.post(`/api/settings/providers/${providerId}/activate`, {})
      await loadSettings()
      setSuccess('Provider 已启用')
    } catch (err) {
      console.error('Failed to activate provider:', err)
      setError('启用 Provider 失败')
    } finally {
      setLoading(false)
    }
  }

  // 删除 Provider
  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm('确定要删除这个 Provider 配置吗？')) {
      return
    }

    try {
      setLoading(true)
      setError(null)
      await api.delete(`/api/settings/providers/${providerId}`)
      await loadSettings()
      setSuccess('Provider 已删除')
    } catch (err) {
      console.error('Failed to delete provider:', err)
      setError('删除 Provider 失败')
    } finally {
      setLoading(false)
    }
  }

  // 复制 Provider
  const handleDuplicateProvider = async (provider: ProviderConfigItem) => {
    try {
      setLoading(true)
      setError(null)
      await api.post('/api/settings/providers', {
        name: `${provider.name} (复制)`,
        provider: provider.provider,
        apiKey: provider.apiKey,
        model: provider.model,
        baseUrl: provider.baseUrl,
      })
      await loadSettings()
      setSuccess('Provider 已复制')
    } catch (err) {
      console.error('Failed to duplicate provider:', err)
      setError('复制 Provider 失败')
    } finally {
      setLoading(false)
    }
  }

  // 测试 Provider
  const handleTestProvider = async (providerId: string) => {
    try {
      setTestingProviderId(providerId)
      const result = await api.post<{
        success: boolean
        error?: string
        details?: string
        latency?: number
        model?: string
      }>(`/api/settings/providers/${providerId}/test`, {})

      setTestResults((prev) => ({
        ...prev,
        [providerId]: result,
      }))
    } catch (err) {
      console.error('Failed to test provider:', err)
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          success: false,
          error: '测试失败',
          details: err instanceof Error ? err.message : '未知错误',
        },
      }))
    } finally {
      setTestingProviderId(null)
    }
  }

  // 开始添加 Provider
  const handleAddProvider = () => {
    setEditingProviderId(null)
    setProviderForm({
      name: '',
      provider: 'claude',
      apiKey: '',
      model: PROVIDER_MODELS['claude'][0],
      baseUrl: '',
    })
    setIsEditingProvider(true)
  }

  // 开始编辑 Provider
  const handleEditProvider = (provider: ProviderConfigItem) => {
    setEditingProviderId(provider.id)
    setProviderForm({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      apiKey: provider.apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl || '',
    })
    setIsEditingProvider(true)
  }

  // 保存 Provider
  const handleSaveProvider = async () => {
    if (!providerForm.name || !providerForm.apiKey || !providerForm.model) {
      setError('请填写完整的 Provider 信息')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const baseUrl = providerForm.baseUrl || PROVIDER_DEFAULT_BASE_URL[providerForm.provider] || undefined

      if (editingProviderId) {
        // 更新现有 Provider
        await api.put(`/api/settings/providers/${editingProviderId}`, {
          ...providerForm,
          baseUrl,
        })
      } else {
        // 添加新 Provider
        await api.post('/api/settings/providers', {
          ...providerForm,
          baseUrl,
        })
      }

      setIsEditingProvider(false)
      setEditingProviderId(null)
      await loadSettings()
      setSuccess('Provider 配置已保存')
    } catch (err) {
      console.error('Failed to save provider:', err)
      setError('保存 Provider 失败')
    } finally {
      setLoading(false)
    }
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setIsEditingProvider(false)
    setEditingProviderId(null)
    setError(null)
  }

  // Provider 类型改变时自动设置默认模型和 baseUrl
  const handleProviderTypeChange = (providerType: string) => {
    setProviderForm({
      ...providerForm,
      provider: providerType,
      model: PROVIDER_MODELS[providerType]?.[0] || '',
      baseUrl: PROVIDER_DEFAULT_BASE_URL[providerType] || '',
    })
  }

  const persistMcpSettings = async (
    nextMcp: McpSettings,
    options?: {
      successMessage?: string
      rollback?: McpSettings
      onSuccess?: (saved: McpSettings) => void
    }
  ) => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.post<{ success: boolean; mcp: McpSettings }>('/api/settings/mcp', nextMcp)
      const savedMcp = response.mcp || nextMcp
      setSettings((prev) => ({ ...prev, mcp: savedMcp }))
      setMcpDraft(savedMcp)
      options?.onSuccess?.(savedMcp)
      if (options?.successMessage) setSuccess(options.successMessage)
      return true
    } catch (err) {
      console.error('Failed to save MCP settings:', err)
      if (options?.rollback) setMcpDraft(options.rollback)
      setError('保存 MCP 设置失败')
      return false
    } finally {
      setLoading(false)
    }
  }

  // MCP Server management
  const addMcpServer = () => {
    const existingNames = new Set(Object.keys(mcpDraft.mcpServers || {}))
    let index = existingNames.size + 1
    let newServerName = `server_${index}`
    while (existingNames.has(newServerName)) {
      index += 1
      newServerName = `server_${index}`
    }
    setMcpDraft((previous) => ({
      enabled: previous.enabled,
      mcpServers: {
        ...previous.mcpServers,
        [newServerName]: { type: 'stdio', command: '', args: [] },
      },
    }))
    setExpandedMcpServer(newServerName)
  }

  const removeMcpServer = async (name: string) => {
    const previousDraft = mcpDraft
    const newServers = { ...(mcpDraft.mcpServers || {}) }
    delete newServers[name]
    const nextMcp: McpSettings = {
      enabled: mcpDraft.enabled,
      mcpServers: newServers,
    }
    setMcpDraft(nextMcp)
    if (expandedMcpServer === name) {
      setExpandedMcpServer(null)
    }
    const saved = await persistMcpSettings(nextMcp, {
      successMessage: 'MCP 服务器已删除',
      rollback: previousDraft,
    })
    if (!saved && expandedMcpServer === name) {
      setExpandedMcpServer(name)
    }
  }

  const updateMcpServer = (name: string, config: Partial<McpServerConfig>) => {
    setMcpDraft((previous) => ({
      enabled: previous.enabled,
      mcpServers: {
        ...previous.mcpServers,
        [name]: { ...(previous.mcpServers?.[name] || { type: 'stdio' }), ...config } as McpServerConfig,
      },
    }))
  }

  const handleToggleMcpEnabled = async (checked: boolean) => {
    const previousDraft = mcpDraft
    const nextMcp: McpSettings = {
      enabled: checked,
      mcpServers: mcpDraft.mcpServers || {},
    }
    setMcpDraft(nextMcp)
    await persistMcpSettings(nextMcp, {
      successMessage: checked ? 'MCP 已启用' : 'MCP 已停用',
      rollback: previousDraft,
    })
  }

  const handleCancelMcpServerEdit = (name: string) => {
    const savedServers = settings.mcp?.mcpServers || {}
    const savedServer = savedServers[name]

    if (savedServer) {
      setMcpDraft((previous) => ({
        enabled: previous.enabled,
        mcpServers: {
          ...previous.mcpServers,
          [name]: savedServer,
        },
      }))
      setMcpNameDrafts((previousDrafts) => ({
        ...previousDrafts,
        [name]: name,
      }))
    } else {
      setMcpDraft((previous) => {
        const nextServers = { ...previous.mcpServers }
        delete nextServers[name]
        return {
          enabled: previous.enabled,
          mcpServers: nextServers,
        }
      })
      setMcpNameDrafts((previousDrafts) => {
        const { [name]: _removed, ...rest } = previousDrafts
        return rest
      })
    }
    setExpandedMcpServer(null)
    setError(null)
  }

  const handleSaveMcpServer = async (name: string) => {
    const draftName = (mcpNameDrafts[name] ?? name).trim()
    if (!draftName) {
      setError('MCP 服务器名称不能为空')
      return
    }

    const renameResult = renameMcpServerRecord(mcpDraft.mcpServers || {}, name, draftName)
    if (!renameResult.changed && renameResult.error === 'duplicate') {
      setError(`MCP 服务器名称 "${renameResult.nextName}" 已存在`)
      return
    }

    const targetConfig = renameResult.servers[renameResult.nextName]
    if (!targetConfig) {
      setError('MCP 服务器配置不存在')
      return
    }

    if (targetConfig.type === 'stdio' && !(targetConfig.command || '').trim()) {
      setError('stdio 类型的 MCP 服务器需要填写命令')
      return
    }

    if ((targetConfig.type === 'http' || targetConfig.type === 'sse') && !(targetConfig.url || '').trim()) {
      setError('HTTP 或 SSE 类型的 MCP 服务器需要填写 URL')
      return
    }

    const nextMcp: McpSettings = {
      enabled: mcpDraft.enabled,
      mcpServers: renameResult.servers,
    }

    setError(null)
    setMcpDraft(nextMcp)
    await persistMcpSettings(nextMcp, {
      successMessage: 'MCP 服务器已保存',
      rollback: mcpDraft,
      onSuccess: (savedMcp) => {
        setExpandedMcpServer(renameResult.nextName)
        setMcpNameDrafts((previousDrafts) => {
          const { [name]: _removed, ...rest } = previousDrafts
          return {
            ...syncMcpNameDrafts(Object.keys(savedMcp.mcpServers || {}), rest),
            [renameResult.nextName]: renameResult.nextName,
          }
        })
      },
    })
  }

  const handleSaveSandbox = async () => {
    try {
      setLoading(true)
      setError(null)
      await api.post('/api/settings/sandbox', settings.sandbox || DEFAULT_SANDBOX_SETTINGS)
      setSuccess('Sandbox 设置已保存')
      await loadSettings()
    } catch (err) {
      console.error('Failed to save sandbox settings:', err)
      setError('保存 Sandbox 设置失败')
    } finally {
      setLoading(false)
    }
  }

  // 保存 Skills 设置
  const handleSaveSkills = async () => {
    try {
      setLoading(true)
      setError(null)
      await api.post('/api/settings/skills', {
        enabled: settings.skills?.enabled ?? true,
        skills: settings.skills?.skills,
        routing: settings.skills?.routing,
      })
      setSuccess('Skills 设置已保存')
    } catch (err) {
      console.error('Failed to save Skills settings:', err)
      setError('保存 Skills 设置失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleAutoAllowTool = (toolName: string, checked: boolean) => {
    const current = new Set(settings.approval?.autoAllowTools || [])
    if (checked) {
      current.add(toolName)
    } else {
      current.delete(toolName)
    }

    setSettings({
      ...settings,
      approval: {
        ...(settings.approval || DEFAULT_APPROVAL_SETTINGS),
        autoAllowTools: Array.from(current),
      },
    })
  }

  const handleSaveApproval = async () => {
    try {
      setLoading(true)
      setError(null)
      await api.post('/api/settings/approval', {
        enabled: settings.approval?.enabled ?? true,
        autoAllowTools: settings.approval?.autoAllowTools || [],
        timeoutMs: settings.approval?.timeoutMs || DEFAULT_APPROVAL_SETTINGS.timeoutMs,
      })
      setSuccess('审批设置已保存')
      await loadSettings()
    } catch (err) {
      console.error('Failed to save approval settings:', err)
      setError('保存审批设置失败')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="ew-settings-backdrop absolute inset-0" onClick={onClose} />

      {/* Modal */}
      <div className="ew-settings-shell relative z-10 flex max-h-[85vh] w-[min(1100px,96vw)] flex-col rounded-xl">
        {/* Header */}
        <div className="ew-settings-header flex items-center justify-between px-6 py-4">
          <div>
            <h2 className="ew-text text-lg font-semibold">设置</h2>
            <p className="ew-subtext text-sm">配置 AI 助手</p>
          </div>
          <button
            onClick={onClose}
            className="ew-icon-btn rounded-lg p-2"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="ew-settings-nav w-52 shrink-0 p-3">
            <div className="ew-subtext mb-2 px-2 text-xs font-medium uppercase tracking-wide">基础配置</div>
            <button
              onClick={() => setActiveTab('provider')}
              className={cn(
                'ew-settings-nav-item mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'provider'
                  ? 'active'
                  : ''
              )}
            >
              <Server className="size-4" />
              模型与 Provider
            </button>
            <button
              onClick={() => setActiveTab('appearance')}
              className={cn(
                'ew-settings-nav-item mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'appearance'
                  ? 'active'
                  : ''
              )}
            >
              <Palette className="size-4" />
              风格设置
            </button>

            <div className="ew-subtext mb-2 mt-4 px-2 text-xs font-medium uppercase tracking-wide">扩展能力</div>
            <button
              onClick={() => setActiveTab('sandbox')}
              className={cn(
                'ew-settings-nav-item mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'sandbox'
                  ? 'active'
                  : ''
              )}
            >
              <Cpu className="size-4" />
              Sandbox
            </button>
            <button
              onClick={() => setActiveTab('mcp')}
              className={cn(
                'ew-settings-nav-item mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'mcp'
                  ? 'active'
                  : ''
              )}
            >
              <BookOpen className="size-4" />
              MCP 服务器
            </button>
            <button
              onClick={() => setActiveTab('skills')}
              className={cn(
                'ew-settings-nav-item mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'skills'
                  ? 'active'
                  : ''
              )}
            >
              <BookOpen className="size-4" />
              Skills
            </button>
            <button
              onClick={() => setActiveTab('approval')}
              className={cn(
                'ew-settings-nav-item mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'approval'
                  ? 'active'
                  : ''
              )}
            >
              <ShieldCheck className="size-4" />
              权限审批
            </button>

            <div className="ew-subtext mb-2 mt-4 px-2 text-xs font-medium uppercase tracking-wide">系统状态</div>
            <button
              onClick={() => setActiveTab('system')}
              className={cn(
                'ew-settings-nav-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeTab === 'system'
                  ? 'active'
                  : ''
              )}
            >
              <Activity className="size-4" />
              环境检查
            </button>
          </aside>

          {/* Content */}
          <div className="ew-settings-content min-h-0 flex-1 overflow-y-auto p-6">
          {/* Provider Tab */}
          {activeTab === 'provider' && (
            <div className="space-y-4">
              {isEditingProvider ? (
                // Provider 编辑/添加表单
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium ew-text">
                      {editingProviderId ? '编辑 Provider' : '添加 Provider'}
                    </h3>
                    <button
                      onClick={handleCancelEdit}
                      className="text-sm ew-subtext hover:text-[color:var(--ui-text)]"
                    >
                      取消
                    </button>
                  </div>

                  {/* 名称 */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium ew-text">
                      名称
                    </label>
                    <input
                      type="text"
                      value={providerForm.name}
                      onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                      placeholder="例如：claude-opus-4.5"
                      className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                    />
                  </div>

                  {/* Provider 类型 */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium ew-text">
                      Provider 类型
                    </label>
                    <select
                      value={providerForm.provider}
                      onChange={(e) => handleProviderTypeChange(e.target.value)}
                      className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                    >
                      <option value="claude">Claude (Anthropic)</option>
                      <option value="glm">GLM (Zhipu)</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="kimi">Kimi (Moonshot AI)</option>
                      <option value="deepseek">DeepSeek</option>
                    </select>
                  </div>

                  {/* API Key */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium ew-text">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={providerForm.apiKey}
                      onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                      placeholder={`输入 ${PROVIDER_LABELS[providerForm.provider]} API key`}
                      className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)] focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                    />
                    <p className="mt-1 text-xs ew-subtext">API Key 仅存储在本地，不会上传到服务器</p>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium ew-text">
                      Model
                    </label>
                    <input
                      list="model-options"
                      type="text"
                      value={providerForm.model}
                      onChange={(e) => setProviderForm({ ...providerForm, model: e.target.value })}
                      placeholder="选择或输入模型名称"
                      className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)] focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                    />
                    <datalist id="model-options">
                      {PROVIDER_MODELS[providerForm.provider]?.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium ew-text">
                      Base URL <span className="ew-subtext">(可选)</span>
                    </label>
                    <input
                      type="text"
                      value={providerForm.baseUrl}
                      onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                      placeholder="自定义 API 端点"
                      className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)] focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                    />
                  </div>

                  {/* 保存按钮 */}
                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      onClick={handleCancelEdit}
                      className="rounded-lg px-4 py-2 text-sm font-medium ew-text hover:bg-[color:var(--ui-accent-soft)]  "
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveProvider}
                      disabled={loading || !providerForm.name || !providerForm.apiKey || !providerForm.model}
                      className={cn(
                        'ew-button-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                        loading || !providerForm.name || !providerForm.apiKey || !providerForm.model
                          ? 'ew-button-primary-disabled'
                          : ''
                      )}
                    >
                      {loading ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              ) : (
                // Provider 列表
                <div className="space-y-4">
                  {/* 添加按钮 */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium ew-text">Provider 配置</h3>
                    <button
                      onClick={handleAddProvider}
                      className="ew-button-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium"
                    >
                      <Plus className="size-3.5" />
                      添加 Provider
                    </button>
                  </div>

                  {/* Provider 列表 */}
                  <div className="space-y-3">
                    {settings.providers.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-8 text-center ">
                        <p className="text-sm ew-subtext">暂无 Provider 配置</p>
                        <p className="mt-1 text-xs ew-subtext">点击上方按钮添加</p>
                      </div>
                    ) : (
                      settings.providers.map((provider) => {
                        const isActive = provider.id === settings.activeProviderId
                        const providerLabel = PROVIDER_LABELS[provider.provider] || provider.provider

                        return (
                          <div
                            key={provider.id}
                            className={cn(
                              'group relative rounded-xl border p-4 transition-all',
                              isActive
                                ? 'border-[color:var(--ui-accent)] bg-[color:var(--ui-accent-soft)]'
                                : 'border-border hover:border-[color:var(--ui-accent)]/40'
                            )}
                          >
                            <div className="flex items-center gap-4">
                              {/* 拖拽手柄 */}
                              <GripVertical className="size-4 ew-subtext opacity-50" />

                              {/* Provider 图标/首字母 */}
                              <div
                                className={cn(
                                  'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium',
                                  isActive
                                    ? 'bg-[color:var(--ui-accent)] text-[color:var(--ui-button-text)]'
                                    : 'bg-[color:var(--ui-accent-soft)] ew-subtext'
                                )}
                              >
                                {provider.name.charAt(0).toUpperCase()}
                              </div>

                              {/* Provider 信息 */}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="truncate text-sm font-medium ew-text">
                                    {provider.name}
                                  </h4>
                                  {isActive && (
                                    <span className="ew-status-chip rounded px-1.5 py-0.5 text-xs font-medium" data-tone="running">
                                      当前启用
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-xs ew-subtext">
                                  {provider.baseUrl || PROVIDER_DEFAULT_BASE_URL[provider.provider]}
                                </p>
                              </div>

                              {/* 操作按钮 */}
                              <div className="flex items-center gap-1">
                                {/* 测试按钮 */}
                                <button
                                  onClick={() => handleTestProvider(provider.id)}
                                  disabled={testingProviderId === provider.id}
                                  className={cn(
                                    'ew-status-icon-btn rounded p-1.5 disabled:opacity-50',
                                    testResults[provider.id]?.success
                                      ? ''
                                      : testResults[provider.id]?.success === false
                                        ? ''
                                        : 'ew-subtext hover:bg-[color:var(--ui-accent-soft)] hover:text-[color:var(--ui-text)]'
                                  )}
                                  data-tone={
                                    testResults[provider.id]?.success === true
                                      ? 'success'
                                      : testResults[provider.id]?.success === false
                                        ? 'danger'
                                        : undefined
                                  }
                                  title={testResults[provider.id]?.success ? '测试通过' : testResults[provider.id]?.success === false ? '测试失败' : '测试连接'}
                                >
                                  {testingProviderId === provider.id ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Activity className="size-4" />
                                  )}
                                </button>

                                {/* 启用按钮 */}
                                {isActive ? (
                                  <button
                                    disabled
                                    className="flex items-center gap-1 rounded-lg bg-[color:var(--ui-accent-soft)] px-3 py-1.5 text-xs font-medium ew-subtext"
                                  >
                                    <Check className="size-3" />
                                    已启用
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleActivateProvider(provider.id)}
                                    disabled={loading}
                                    className="ew-button-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                                  >
                                    <Play className="size-3" />
                                    启用
                                  </button>
                                )}

                                {/* 编辑按钮 */}
                                <button
                                  onClick={() => handleEditProvider(provider)}
                                  className="rounded p-1.5 ew-subtext hover:bg-[color:var(--ui-accent-soft)] hover:text-[color:var(--ui-text)]"
                                  title="编辑"
                                >
                                  <Edit2 className="size-4" />
                                </button>

                                {/* 复制按钮 */}
                                <button
                                  onClick={() => handleDuplicateProvider(provider)}
                                  className="rounded p-1.5 ew-subtext hover:bg-[color:var(--ui-accent-soft)] hover:text-[color:var(--ui-text)]"
                                  title="复制"
                                >
                                  <Copy className="size-4" />
                                </button>

                                {/* 删除按钮 */}
                                <button
                                  onClick={() => handleDeleteProvider(provider.id)}
                                  className="rounded p-1.5 ew-subtext hover:bg-[color:var(--ui-danger-soft)] hover:text-[color:var(--ui-danger)]"
                                  title="删除"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>
                            </div>

                            {/* 测试结果 */}
                            {testResults[provider.id] && (
                              <div
                                className={cn(
                                  'ew-status-panel mt-3 rounded-lg px-3 py-2 text-xs',
                                  testResults[provider.id].success
                                    ? ''
                                    : ''
                                )}
                                data-tone={testResults[provider.id].success ? 'success' : 'danger'}
                              >
                                <div className="flex items-center gap-2">
                                  {testResults[provider.id].success ? (
                                    <Check className="size-3.5" />
                                  ) : (
                                    <X className="size-3.5" />
                                  )}
                                  <span className="font-medium">
                                    {testResults[provider.id].success ? '连接成功' : '连接失败'}
                                  </span>
                                  {testResults[provider.id].latency && (
                                    <span className="ew-subtext">
                                      ({testResults[provider.id].latency}ms)
                                    </span>
                                  )}
                                </div>
                                {testResults[provider.id].details && (
                                  <p className="mt-1 pl-5 ew-subtext">
                                    {testResults[provider.id].details}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div className="ew-card p-4">
                <h3 className="ew-text text-sm font-medium">主题</h3>
                <p className="ew-subtext mt-1 text-xs">
                  使用浅色、深色，或匹配系统设置
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-all',
                    theme === 'light'
                      ? 'border-[color:var(--ui-accent)] bg-[color:var(--ui-accent-soft)]'
                      : 'border-[color:var(--ui-border)] hover:border-[color:var(--ui-accent)] hover:bg-[color:var(--ui-accent-soft)]'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sun className="size-4 text-[color:var(--ui-accent)]" />
                      <span className="ew-text text-sm font-medium">浅色</span>
                    </div>
                    {theme === 'light' && (
                      <span className="ew-status-chip rounded-full px-2 py-0.5 text-xs font-medium" data-tone="running">
                        当前
                      </span>
                    )}
                  </div>
                  <p className="ew-subtext mt-2 text-xs">
                    明亮、清爽、适合白天环境和长文阅读
                  </p>
                </button>

                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-all',
                    theme === 'dark'
                      ? 'border-[color:var(--ui-accent)] bg-[color:var(--ui-accent-soft)]'
                      : 'border-[color:var(--ui-border)] hover:border-[color:var(--ui-accent)] hover:bg-[color:var(--ui-accent-soft)]'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Moon className="size-4 text-[color:var(--ui-accent)]" />
                      <span className="ew-text text-sm font-medium">深色</span>
                    </div>
                    {theme === 'dark' && (
                      <span className="ew-status-chip rounded-full px-2 py-0.5 text-xs font-medium" data-tone="running">
                        当前
                      </span>
                    )}
                  </div>
                  <p className="ew-subtext mt-2 text-xs">
                    更沉浸、更护眼，适合夜间环境和聚焦工作
                  </p>
                </button>

                <button
                  onClick={() => setTheme('system')}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-all',
                    theme === 'system'
                      ? 'border-[color:var(--ui-accent)] bg-[color:var(--ui-accent-soft)]'
                      : 'border-[color:var(--ui-border)] hover:border-[color:var(--ui-accent)] hover:bg-[color:var(--ui-accent-soft)]'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Monitor className="size-4 text-[color:var(--ui-accent)]" />
                      <span className="ew-text text-sm font-medium">系统</span>
                    </div>
                    {theme === 'system' && (
                      <span className="ew-status-chip rounded-full px-2 py-0.5 text-xs font-medium" data-tone="running">
                        当前
                      </span>
                    )}
                  </div>
                  <p className="ew-subtext mt-2 text-xs">
                    自动跟随系统浅色或深色设置
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Sandbox Tab */}
          {activeTab === 'sandbox' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-4 ">
                <div>
                  <h3 className="text-sm font-medium ew-text">启用 Sandbox</h3>
                  <p className="text-xs ew-subtext">通过沙箱工具执行命令和脚本，减少本机直执行风险</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={settings.sandbox?.enabled ?? false}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        sandbox: {
                          ...(settings.sandbox || DEFAULT_SANDBOX_SETTINGS),
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="peer sr-only"
                  />
                  <div className="ew-switch-track" />
                </label>
              </div>

              <div className="rounded-lg border border-border p-4 ">
                <label className="mb-1.5 block text-sm font-medium ew-text">
                  Provider
                </label>
                <select
                  value={settings.sandbox?.provider || 'native'}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sandbox: {
                        ...(settings.sandbox || DEFAULT_SANDBOX_SETTINGS),
                        provider: e.target.value as SandboxSettings['provider'],
                      },
                    })
                  }
                  className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                >
                  <option value="native">native（本地受限执行）</option>
                  <option value="claude">claude</option>
                  <option value="docker">docker</option>
                  <option value="e2b">e2b</option>
                </select>
              </div>

              <div className="rounded-lg border border-border p-4 ">
                <label className="mb-1.5 block text-sm font-medium ew-text">
                  Sandbox API Endpoint
                </label>
                <input
                  type="text"
                  value={settings.sandbox?.apiEndpoint || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sandbox: {
                        ...(settings.sandbox || DEFAULT_SANDBOX_SETTINGS),
                        apiEndpoint: e.target.value,
                      },
                    })
                  }
                  placeholder="例如: http://localhost:2026/api"
                  className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)] focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                />
                <p className="mt-1 text-xs ew-subtext">默认使用本机 API 服务地址：`/api/sandbox/*`</p>
              </div>

              <div className="rounded-lg border border-border p-4 ">
                <label className="mb-1.5 block text-sm font-medium ew-text">
                  容器镜像 <span className="ew-subtext">(可选)</span>
                </label>
                <input
                  type="text"
                  value={settings.sandbox?.image || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sandbox: {
                        ...(settings.sandbox || DEFAULT_SANDBOX_SETTINGS),
                        image: e.target.value,
                      },
                    })
                  }
                  placeholder="例如: node:20-alpine"
                  className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)] focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveSandbox}
                  disabled={loading}
                  className={cn(
                    'ew-button-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    loading ? 'ew-button-primary-disabled' : ''
                  )}
                >
                  {loading ? '保存中...' : '保存 Sandbox 设置'}
                </button>
              </div>
            </div>
          )}

          {/* MCP Tab */}
          {activeTab === 'mcp' && (
            <div className="space-y-4">
              {/* Enable MCP */}
              <div className="flex items-center justify-between rounded-lg border border-border p-4 ">
                <div>
                  <h3 className="text-sm font-medium ew-text">启用 MCP</h3>
                  <p className="text-xs ew-subtext">允许 AI 使用 MCP 服务器提供的工具</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={mcpDraft.enabled ?? false}
                    onChange={(e) => handleToggleMcpEnabled(e.target.checked)}
                    disabled={loading}
                    className="peer sr-only"
                  />
                  <div className="ew-switch-track" />
                </label>
              </div>

              {/* MCP Servers List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium ew-text">MCP 服务器</h3>
                  <button
                    onClick={addMcpServer}
                    className="ew-button-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium"
                  >
                    <Plus className="size-3.5" />
                    添加服务器
                  </button>
                </div>

                {Object.entries(mcpDraft.mcpServers || {}).map(([name, config]) => (
                  <div key={name} className="rounded-lg border border-border ">
                    {/* Server Header */}
                    <div
                      className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-[color:var(--ui-panel-2)] "
                      onClick={() => setExpandedMcpServer(expandedMcpServer === name ? null : name)}
                    >
                      <div className="flex items-center gap-3">
                        {expandedMcpServer === name ? (
                          <ChevronUp className="size-4 ew-subtext" />
                        ) : (
                          <ChevronDown className="size-4 ew-subtext" />
                        )}
                        <input
                          type="text"
                          value={mcpNameDrafts[name] ?? name}
                          onChange={(e) => {
                            e.stopPropagation()
                            const nextValue = e.target.value
                            setError(null)
                            setMcpNameDrafts((previousDrafts) => ({
                              ...previousDrafts,
                              [name]: nextValue,
                            }))
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleSaveMcpServer(name)
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              handleCancelMcpServerEdit(name)
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border border-border px-2 py-1 text-sm font-medium ew-text   "
                        />
                        <span className="rounded bg-[color:var(--ui-accent-soft)] px-2 py-0.5 text-xs ew-subtext">
                          {config.type}
                        </span>
                      </div>
                      <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void removeMcpServer(name)
                          }}
                        className="rounded p-1.5 ew-subtext hover:bg-[color:var(--ui-danger-soft)] hover:text-[color:var(--ui-danger)]"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    {/* Server Details */}
                    {expandedMcpServer === name && (
                      <div className="border-t border-border px-4 py-3 ">
                        <div className="space-y-3">
                          {/* Type */}
                          <div>
                            <label className="mb-1 block text-xs font-medium ew-text">
                              类型
                            </label>
                            <select
                              value={config.type}
                              onChange={(e) =>
                                updateMcpServer(name, { type: e.target.value as McpServerConfig['type'] })
                              }
                              className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none   "
                            >
                              <option value="stdio">stdio (命令行)</option>
                              <option value="http">HTTP</option>
                              <option value="sse">SSE (Server-Sent Events)</option>
                            </select>
                          </div>

                          {/* stdio specific fields */}
                          {config.type === 'stdio' && (
                            <>
                              <div>
                                <label className="mb-1 block text-xs font-medium ew-text">
                                  命令
                                </label>
                                <input
                                  type="text"
                                  value={config.command || ''}
                                  onChange={(e) => updateMcpServer(name, { command: e.target.value })}
                                  placeholder="例如: npx, node, python"
                                  className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)]   "
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium ew-text">
                                  参数 (用空格分隔)
                                </label>
                                <input
                                  type="text"
                                  value={config.args?.join(' ') || ''}
                                  onChange={(e) =>
                                    updateMcpServer(name, {
                                      args: e.target.value.split(' ').filter(Boolean),
                                    })
                                  }
                                  placeholder="例如: -y @modelcontextprotocol/server-filesystem /path/to/dir"
                                  className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)]   "
                                />
                              </div>
                            </>
                          )}

                          {/* HTTP/SSE specific fields */}
                          {(config.type === 'http' || config.type === 'sse') && (
                            <div>
                              <label className="mb-1 block text-xs font-medium ew-text">
                                URL
                              </label>
                              <input
                                type="text"
                                value={config.url || ''}
                                onChange={(e) => updateMcpServer(name, { url: e.target.value })}
                                placeholder="例如: http://localhost:3000/sse"
                                className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none placeholder:text-[color:var(--ui-subtext)]   "
                              />
                            </div>
                          )}

                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleCancelMcpServerEdit(name)}
                              className="rounded-lg border border-border px-3 py-2 text-sm ew-text transition-colors hover:bg-[color:var(--ui-panel-2)]"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveMcpServer(name)}
                              disabled={loading}
                              className={cn(
                                'ew-button-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                                loading ? 'ew-button-primary-disabled' : ''
                              )}
                            >
                              {loading ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {Object.keys(mcpDraft.mcpServers || {}).length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center ">
                    <p className="text-sm ew-subtext">暂无 MCP 服务器</p>
                    <p className="mt-1 text-xs ew-subtext">点击上方按钮添加</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Skills Tab */}
          {activeTab === 'skills' && (
            <div className="space-y-4">
              {/* Enable Skills */}
              <div className="flex items-center justify-between rounded-lg border border-border p-4 ">
                <div>
                  <h3 className="text-sm font-medium ew-text">启用 Skills</h3>
                  <p className="text-xs ew-subtext">允许 AI 使用自定义 Skills</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={settings.skills?.enabled ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        skills: {
                          ...settings.skills,
                          enabled: e.target.checked,
                          routing: settings.skills?.routing || DEFAULT_SKILL_ROUTING,
                          sources: settings.skills?.sources || [],
                        },
                      })
                    }
                    className="peer sr-only"
                  />
                  <div className="ew-switch-track" />
                </label>
              </div>

              <SkillRoutingPanel
                disabled={!(settings.skills?.enabled ?? true)}
                value={settings.skills?.routing}
                onChange={(routing) =>
                  setSettings({
                    ...settings,
                    skills: {
                      ...settings.skills,
                      enabled: settings.skills?.enabled ?? true,
                      skills: settings.skills?.skills,
                      sources: settings.skills?.sources || [],
                      routing,
                    },
                  })
                }
              />

              <SkillSourcesPanel
                disabled={!(settings.skills?.enabled ?? true)}
                onInstalled={() => setSkillsManagerReloadKey((prev) => prev + 1)}
              />

              {/* Skills Manager */}
              {settings.skills?.enabled && (
                <SkillsManager
                  key={`skills-manager-${skillsManagerReloadKey}`}
                  globalEnabled={settings.skills?.enabled ?? true}
                  skillsConfig={settings.skills?.skills}
                  onConfigChange={(skills) =>
                    setSettings({
                      ...settings,
                      skills: {
                        enabled: settings.skills?.enabled ?? true,
                        routing: settings.skills?.routing || DEFAULT_SKILL_ROUTING,
                        sources: settings.skills?.sources || [],
                        skills,
                      },
                    })
                  }
                />
              )}

              {/* Skills Info (when disabled) */}
              {!settings.skills?.enabled && (
                <div className="rounded-lg bg-[color:var(--ui-panel-2)] p-4 ">
                  <h4 className="mb-2 text-sm font-medium ew-text">关于 Skills</h4>
                  <p className="text-xs ew-subtext">
                    Skills 是自定义的 AI 指令，存储在以下位置：
                  </p>
                  <ul className="mt-2 list-inside list-disc text-xs ew-subtext">
                    <li>项目目录/SKILLs/ - 项目级 Skills 源目录</li>
                    <li>会话目录/.claude/skills/ - 运行时装配目录</li>
                  </ul>
                  <p className="mt-2 text-xs ew-subtext">
                    每个 Skill 是一个包含 SKILL.md 文件的目录
                  </p>
                </div>
              )}

              {/* 保存 Skills 设置按钮 */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveSkills}
                  disabled={loading}
                  className={cn(
                    'ew-button-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    loading ? 'ew-button-primary-disabled' : ''
                  )}
                >
                  {loading ? '保存中...' : '保存 Skills 设置'}
                </button>
              </div>
            </div>
          )}

          {/* Approval Tab */}
          {activeTab === 'approval' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-4 ">
                <div>
                  <h3 className="text-sm font-medium ew-text">启用审批拦截</h3>
                  <p className="text-xs ew-subtext">关闭后高风险底层工具将直接执行，不再弹出审批</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={settings.approval?.enabled ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        approval: {
                          ...(settings.approval || DEFAULT_APPROVAL_SETTINGS),
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="peer sr-only"
                  />
                  <div className="ew-switch-track" />
                </label>
              </div>

              <div className="rounded-lg border border-border p-4 ">
                <label className="mb-1.5 block text-sm font-medium ew-text">
                  审批超时时间（分钟）
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={Math.max(1, Math.round((settings.approval?.timeoutMs || DEFAULT_APPROVAL_SETTINGS.timeoutMs) / 60000))}
                  onChange={(e) => {
                    const minutes = Math.max(1, Number(e.target.value) || 1)
                    setSettings({
                      ...settings,
                      approval: {
                        ...(settings.approval || DEFAULT_APPROVAL_SETTINGS),
                        timeoutMs: minutes * 60 * 1000,
                      },
                    })
                  }}
                  className="w-full rounded-lg border border-border bg-[color:var(--ui-panel)] px-3 py-2 text-sm ew-text outline-none focus:border-[color:var(--ui-accent)] focus:ring-1 focus:ring-[color:var(--ui-accent)]   "
                />
                <p className="mt-1 text-xs ew-subtext">
                  到达超时后，待审批请求将自动标记为已超时并终止当前执行
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-border p-4 ">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium ew-text">免审批工具列表</h3>
                  <span className="text-xs ew-subtext">
                    未勾选的工具会进入审批
                  </span>
                </div>
                <p className="text-xs ew-subtext">
                  Skill 和已配置的 MCP 能力由用户设置直接控制，不在权限审批范围内；这里只管理 Bash、文件编辑、联网等高风险底层工具。
                </p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {APPROVAL_TOOL_OPTIONS.map((tool) => {
                    const checked = (settings.approval?.autoAllowTools || []).includes(tool.name)
                    return (
                      <label
                        key={tool.name}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 hover:bg-[color:var(--ui-panel-2)]  "
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={(e) => toggleAutoAllowTool(tool.name, e.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium ew-text">{tool.name}</span>
                          <span className="block text-xs ew-subtext">{tool.desc}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveApproval}
                  disabled={loading}
                  className={cn(
                    'ew-button-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    loading ? 'ew-button-primary-disabled' : ''
                  )}
                >
                  {loading ? '保存中...' : '保存审批设置'}
                </button>
              </div>
            </div>
          )}

          {/* System Tab */}
          {activeTab === 'system' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-[color:var(--ui-panel-2)] px-4 py-3  ">
                <div>
                  <h3 className="text-sm font-medium ew-text">运行环境检查</h3>
                  <p className="text-xs ew-subtext">
                    启动前依赖状态与当前配置概览
                  </p>
                </div>
                <button
                  onClick={loadSystemStatus}
                  disabled={systemLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs ew-subtext hover:bg-[color:var(--ui-accent-soft)] disabled:opacity-50   "
                >
                  <RefreshCw className={cn('size-3.5', systemLoading && 'animate-spin')} />
                  刷新
                </button>
              </div>

              {systemStatus ? (
                <div className="space-y-2 rounded-lg border border-border p-4 ">
                  <StatusItem label="Claude Code 已安装" ok={systemStatus.claudeCode} />
                  <StatusItem label="Provider 已配置" ok={systemStatus.providerConfigured} />
                  <StatusItem label="已选择启用 Provider" ok={systemStatus.activeProvider} />
                  <div className="mt-3 border-t border-border pt-3 text-xs ew-subtext">
                    当前共检测到 {systemStatus.providers} 个 Provider 配置
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-6 text-sm ew-subtext">
                  {systemLoading ? '正在检查系统状态...' : '暂无系统状态数据'}
                </div>
              )}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="ew-status-panel mt-4 rounded-lg p-3 text-sm" data-tone="success">
              {success}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="ew-status-panel mt-4 rounded-lg p-3 text-sm" data-tone="danger">
              {error}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
