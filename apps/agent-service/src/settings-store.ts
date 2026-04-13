/**
 * Settings persistence module
 * 支持多 Provider 配置管理
 */

import * as fs from 'fs'
import { resolveArclayPath } from './shared/arclay-home'
import { createLogger } from './shared/logger'

const log = createLogger('settings-store')

function getSettingsDir(): string {
  return resolveArclayPath()
}

function getSettingsFile(): string {
  return resolveArclayPath('settings.json')
}

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

  log.info('Migrated from legacy format')
  return migrated
}

/**
 * Load settings from file
 */
export function loadSettingsFromFile(): Settings | null {
  const settingsDir = getSettingsDir()
  const settingsFile = getSettingsFile()

  log.debug({ file: settingsFile, settingsDir }, 'Loading settings')

  try {
    // Check if directory exists
    if (!fs.existsSync(settingsDir)) {
      log.debug({ settingsDir }, 'Settings directory does not exist')
      return null
    }

    if (fs.existsSync(settingsFile)) {
      const content = fs.readFileSync(settingsFile, 'utf-8')
      log.debug({ file: settingsFile, size: content.length }, 'Reading settings file')

      const settings = JSON.parse(content) as Settings
      const migrated = migrateFromLegacy(settings)
      log.info({ providers: migrated.providers.length, activeId: migrated.activeProviderId }, 'Settings loaded')
      return migrated
    } else {
      log.debug({ file: settingsFile }, 'Settings file does not exist')
    }
  } catch (err) {
    log.error(err, 'Failed to load settings from file')
  }
  return null
}

/**
 * Save settings to file
 */
export function saveSettingsToFile(settings: Settings): void {
  const settingsDir = getSettingsDir()
  const settingsFile = getSettingsFile()

  log.debug({ file: settingsFile, settingsDir, providers: settings.providers?.length || 0, activeId: settings.activeProviderId || '(none)' }, 'Saving settings')

  try {
    // Ensure directory exists
    if (!fs.existsSync(settingsDir)) {
      log.debug({ settingsDir }, 'Creating settings directory')
      fs.mkdirSync(settingsDir, { recursive: true })
      log.debug({ settingsDir }, 'Directory created')
    } else {
      // Check directory permissions
      try {
        const stat = fs.statSync(settingsDir)
        log.debug({ settingsDir, mode: stat.mode.toString(8) }, 'Directory permissions')
      } catch (statErr) {
        log.error(statErr, 'Failed to check directory permissions')
      }
    }

    const settingsJson = JSON.stringify(settings, null, 2)
    log.debug({ file: settingsFile, size: settingsJson.length }, 'Writing settings file')

    fs.writeFileSync(settingsFile, settingsJson)
    log.info({ file: settingsFile, providers: settings.providers?.length || 0, activeId: settings.activeProviderId }, 'Settings saved')

    // Verify the file was written correctly
    try {
      const writtenContent = fs.readFileSync(settingsFile, 'utf-8')
      const writtenSettings = JSON.parse(writtenContent)
      log.debug({ providers: writtenSettings.providers?.length || 0 }, 'Verified saved settings')
    } catch (verifyErr) {
      log.error(verifyErr, 'Failed to verify saved file')
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as NodeJS.ErrnoException).code
      log.error({ err, code, settingsDir }, 'Failed to save settings')
    } else {
      log.error(err, 'Failed to save settings')
    }
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
