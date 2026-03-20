/**
 * Settings persistence module
 * 支持多 Provider 配置管理
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Settings file path
const SETTINGS_DIR = path.join(os.homedir(), '.easywork')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

// MCP Server 配置
export interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

// MCP 配置
export interface McpSettings {
  enabled: boolean
  mcpServers: Record<string, McpServerConfig>
}

// Skill 提供商配置
export interface SkillProviderConfig {
  claude: boolean
  codex: boolean
  gemini: boolean
}

// 单个 Skill 的配置
export interface SkillItemConfig {
  enabled: boolean
  providers: SkillProviderConfig
}

// Skill 自动路由配置
export interface SkillRoutingSettings {
  mode: 'off' | 'assist' | 'auto'
  topN: number
  minScore: number
  llmRerank: boolean
  includeExplain: boolean
  fallback: 'all_enabled' | 'none'
}

// Skill 来源配置
export interface SkillSourceConfig {
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

// Skill 配置
export interface SkillSettings {
  enabled: boolean
  // 每个 skill 的独立配置，key 是 skill id (格式: "source:name")
  skills?: Record<string, SkillItemConfig>
  // 自动路由配置
  routing?: SkillRoutingSettings
  // 来源管理配置
  sources?: SkillSourceConfig[]
}

// 审批配置
export interface ApprovalSettings {
  enabled: boolean
  autoAllowTools: string[]
  timeoutMs: number
}

// Sandbox 配置
export interface SandboxSettings {
  enabled: boolean
  provider?: 'native' | 'claude' | 'docker' | 'e2b'
  apiEndpoint?: string
  image?: string
}

// Provider 配置项（单个 Provider 的完整配置）
export interface ProviderConfigItem {
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

// Settings type - 新版支持多 Provider 配置
export interface Settings {
  // 当前生效的 Provider ID
  activeProviderId: string | null
  // 所有 Provider 配置列表
  providers: ProviderConfigItem[]
  // MCP 配置
  mcp?: McpSettings
  // Skills 配置
  skills?: SkillSettings
  // Approval 配置
  approval?: ApprovalSettings
  // Sandbox 配置
  sandbox?: SandboxSettings

  // 兼容旧版本 - 如果存在则迁移到新格式
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

// In-memory settings cache
let settingsCache: Settings | null = null

const DEFAULT_SKILL_ROUTING_SETTINGS: SkillRoutingSettings = {
  mode: 'assist',
  topN: 3,
  minScore: 0.35,
  llmRerank: false,
  includeExplain: true,
  fallback: 'all_enabled',
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = {
  enabled: true,
  routing: { ...DEFAULT_SKILL_ROUTING_SETTINGS },
  sources: [],
}

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  enabled: true,
  autoAllowTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'LS', 'LSP'],
  timeoutMs: 10 * 60 * 1000,
}

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  enabled: false,
  provider: 'native',
  apiEndpoint: 'http://localhost:2026/api',
}

export function getDefaultSkillRoutingSettings(): SkillRoutingSettings {
  return { ...DEFAULT_SKILL_ROUTING_SETTINGS }
}

export function normalizeSkillSettings(settings?: SkillSettings): SkillSettings {
  return {
    enabled: settings?.enabled ?? true,
    skills: settings?.skills,
    routing: {
      ...DEFAULT_SKILL_ROUTING_SETTINGS,
      ...(settings?.routing || {}),
    },
    sources: settings?.sources || [],
  }
}

export function normalizeApprovalSettings(settings?: ApprovalSettings): ApprovalSettings {
  const timeoutMs = Number(settings?.timeoutMs)
  return {
    enabled: settings?.enabled ?? DEFAULT_APPROVAL_SETTINGS.enabled,
    autoAllowTools: Array.isArray(settings?.autoAllowTools)
      ? settings!.autoAllowTools.filter((tool) => typeof tool === 'string' && tool.trim().length > 0)
      : [...DEFAULT_APPROVAL_SETTINGS.autoAllowTools],
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_APPROVAL_SETTINGS.timeoutMs,
  }
}

export function normalizeSandboxSettings(settings?: SandboxSettings): SandboxSettings {
  const provider = settings?.provider
  const normalizedProvider = provider && ['native', 'claude', 'docker', 'e2b'].includes(provider)
    ? provider
    : DEFAULT_SANDBOX_SETTINGS.provider

  const apiEndpoint = typeof settings?.apiEndpoint === 'string' && settings.apiEndpoint.trim().length > 0
    ? settings.apiEndpoint.trim()
    : DEFAULT_SANDBOX_SETTINGS.apiEndpoint

  const image = typeof settings?.image === 'string' && settings.image.trim().length > 0
    ? settings.image.trim()
    : undefined

  return {
    enabled: settings?.enabled ?? DEFAULT_SANDBOX_SETTINGS.enabled,
    provider: normalizedProvider,
    apiEndpoint,
    image,
  }
}

/**
 * 从旧版本配置迁移到新版本
 */
function migrateFromLegacy(settings: Settings): Settings {
  // 如果已经有 providers 数组，说明已经是新版本
  if (settings.providers && Array.isArray(settings.providers)) {
    return {
      ...settings,
      skills: normalizeSkillSettings(settings.skills),
      approval: normalizeApprovalSettings(settings.approval),
      sandbox: normalizeSandboxSettings(settings.sandbox),
    }
  }

  // 从旧版本迁移
  const migrated: Settings = {
    activeProviderId: null,
    providers: [],
    mcp: settings.mcp || { enabled: false, mcpServers: {} },
    skills: normalizeSkillSettings(settings.skills),
    approval: normalizeApprovalSettings(settings.approval),
    sandbox: normalizeSandboxSettings(settings.sandbox),
  }

  // 如果旧版本有配置，转换为新格式
  if (settings.provider && settings.apiKey) {
    const id = `provider_${Date.now()}`
    const providerItem: ProviderConfigItem = {
      id,
      name: `${settings.provider}-${settings.model}`,
      provider: settings.provider,
      apiKey: settings.apiKey,
      model: settings.model || '',
      baseUrl: settings.baseUrl,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    migrated.providers.push(providerItem)
    migrated.activeProviderId = id
  }

  console.log('[Settings] Migrated from legacy format')
  return migrated
}

/**
 * Load settings from file
 */
export function loadSettingsFromFile(): Settings | null {
  console.log('[Settings] Attempting to load settings from:', SETTINGS_FILE)
  console.log('[Settings] Settings directory:', SETTINGS_DIR)

  try {
    // Check if directory exists
    if (!fs.existsSync(SETTINGS_DIR)) {
      console.log('[Settings] Settings directory does not exist:', SETTINGS_DIR)
      return null
    }

    if (fs.existsSync(SETTINGS_FILE)) {
      const content = fs.readFileSync(SETTINGS_FILE, 'utf-8')
      console.log('[Settings] File content length:', content.length)

      const settings = JSON.parse(content) as Settings
      const migrated = migrateFromLegacy(settings)
      console.log('[Settings] Loaded settings - providers:', migrated.providers.length, 'active:', migrated.activeProviderId)
      return migrated
    } else {
      console.log('[Settings] Settings file does not exist:', SETTINGS_FILE)
    }
  } catch (err) {
    console.error('[Settings] Failed to load settings from file:', err)
    if (err instanceof Error) {
      console.error('[Settings] Error name:', err.name)
      console.error('[Settings] Error message:', err.message)
      console.error('[Settings] Error stack:', err.stack)
    }
  }
  return null
}

/**
 * Save settings to file
 */
export function saveSettingsToFile(settings: Settings): void {
  console.log('[Settings] Attempting to save settings to:', SETTINGS_FILE)
  console.log('[Settings] Settings directory:', SETTINGS_DIR)
  console.log('[Settings] Providers count:', settings.providers?.length || 0)
  console.log('[Settings] Active provider:', settings.activeProviderId || '(none)')

  try {
    // Ensure directory exists
    if (!fs.existsSync(SETTINGS_DIR)) {
      console.log('[Settings] Creating settings directory:', SETTINGS_DIR)
      fs.mkdirSync(SETTINGS_DIR, { recursive: true })
      console.log('[Settings] Directory created successfully')
    } else {
      console.log('[Settings] Directory already exists:', SETTINGS_DIR)
      // Check directory permissions
      try {
        const stat = fs.statSync(SETTINGS_DIR)
        console.log('[Settings] Directory permissions:', stat.mode.toString(8))
      } catch (statErr) {
        console.error('[Settings] Failed to check directory permissions:', statErr)
      }
    }

    const settingsJson = JSON.stringify(settings, null, 2)
    console.log('[Settings] Writing settings file, size:', settingsJson.length, 'bytes')

    fs.writeFileSync(SETTINGS_FILE, settingsJson)
    console.log('[Settings] Successfully saved settings to file:', SETTINGS_FILE)

    // Verify the file was written correctly
    try {
      const writtenContent = fs.readFileSync(SETTINGS_FILE, 'utf-8')
      const writtenSettings = JSON.parse(writtenContent)
      console.log('[Settings] Verified saved settings - providers:', writtenSettings.providers?.length || 0)
    } catch (verifyErr) {
      console.error('[Settings] Failed to verify saved file:', verifyErr)
    }
  } catch (err) {
    console.error('[Settings] ===== FAILED TO SAVE SETTINGS =====')
    console.error('[Settings] Error:', err)
    if (err instanceof Error) {
      console.error('[Settings] Error name:', err.name)
      console.error('[Settings] Error message:', err.message)
      console.error('[Settings] Error stack:', err.stack)
    }
    // Check for common filesystem errors
    if (err instanceof Error) {
      if ('code' in err) {
        const code = (err as NodeJS.ErrnoException).code
        console.error('[Settings] Error code:', code)
        switch (code) {
          case 'EACCES':
            console.error('[Settings] Permission denied - check write permissions for:', SETTINGS_DIR)
            break
          case 'ENOSPC':
            console.error('[Settings] No space left on device')
            break
          case 'EROFS':
            console.error('[Settings] Read-only file system')
            break
          case 'EISDIR':
            console.error('[Settings] Path is a directory, not a file')
            break
        }
      }
    }
    console.error('[Settings] ======================================')
  }
}

/**
 * Get cached settings
 */
export function getSettings(): Settings | null {
  return settingsCache
}

/**
 * Set cached settings
 */
export function setSettings(settings: Settings): void {
  settingsCache = settings
}

/**
 * 获取当前生效的 Provider 配置
 */
export function getActiveProviderConfig(): ProviderConfigItem | null {
  const settings = settingsCache
  if (!settings || !settings.activeProviderId || !settings.providers) {
    return null
  }

  return settings.providers.find(p => p.id === settings.activeProviderId) || null
}

/**
 * 设置当前生效的 Provider
 */
export function setActiveProvider(providerId: string): boolean {
  const settings = settingsCache
  if (!settings || !settings.providers) {
    return false
  }

  const provider = settings.providers.find(p => p.id === providerId)
  if (!provider) {
    return false
  }

  settings.activeProviderId = providerId
  provider.enabled = true
  settingsCache = { ...settings }
  return true
}

// Load settings on module initialization
settingsCache = loadSettingsFromFile()
