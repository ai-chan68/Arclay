/**
 * Settings API routes
 * 支持多 Provider 配置管理
 */

import { createLogger } from '../shared/logger'
import { Hono } from 'hono'
import { createAgentService, type AgentServiceConfig } from '../services/agent-service'
import { getWorkDir, getProjectRoot } from '../config'
import {
  getSettings,
  setSettings,
  saveSettingsToFile,
  getActiveProviderConfig,
  getDefaultSkillRoutingSettings,
  normalizeSkillSettings,
  normalizeApprovalSettings,
  normalizeSandboxSettings,
  type Settings,
  type McpSettings,
  type SkillSettings,
  type ApprovalSettings,
  type SandboxSettings,
  type ProviderConfigItem,
} from '../settings-store'
import { getAllSkills, getSkillsStats, importSkill, deleteSkill, type SkillInfo } from '../services/skills-service'
import * as fs from 'fs'
import * as path from 'path'
import { routeSkillsForPrompt } from '../skills/router'
import {
  installSkillFromSource,
  updateSkillFromSources,
  repairSkillFromSources,
  validateSourceForInstall,
} from '../skills/ecosystem-service'
import {
  loadSkillSourceBindings,
  removeSkillSourceBinding,
  upsertSkillSourceBindings,
} from '../skills/source-binding-store'
import type { AgentRuntimeState } from '../runtime/app-runtime'
import type { SkillSourceConfig } from '../settings-store'

export interface SettingsRouteDeps {
  getAgentRuntimeState: () => AgentRuntimeState
  setAgentRuntimeState: (state: AgentRuntimeState) => void
  workDir: string
}

export function createSettingsRoutes(
  deps: SettingsRouteDeps
): Hono {
  assertSettingsRouteDeps(deps)
  const log = createLogger('routes:settings')
  const settingsRoutes = new Hono()

function getDefaultSkillsSettings(): SkillSettings {
  return normalizeSkillSettings({ enabled: true })
}

function getDefaultApprovalSettings(): ApprovalSettings {
  return normalizeApprovalSettings()
}

function getDefaultSandboxSettings(): SandboxSettings {
  return normalizeSandboxSettings()
}

function buildRuntimeMcpConfig(settings?: Settings): AgentServiceConfig['mcp'] {
  if (!settings?.mcp?.enabled) {
    return undefined
  }

  const mcpServers: NonNullable<AgentServiceConfig['mcp']>['mcpServers'] = {}

  for (const [name, config] of Object.entries(settings.mcp.mcpServers || {})) {
    if (config.type === 'stdio' || config.type === 'sse' || config.type === 'http') {
      mcpServers[name] = {
        type: config.type,
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
      }
    }
  }

  return {
    enabled: true,
    userDirEnabled: false,
    appDirEnabled: false,
    mcpServers,
  }
}

type SkillHealthStatus = 'healthy' | 'warning' | 'broken'

function inspectSkillHealth(skill: SkillInfo, activeProvider?: string): {
  status: SkillHealthStatus
  issues: string[]
  warnings: string[]
  suggestions: string[]
} {
  const issues: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []
  const skillMdPath = path.join(skill.path, 'SKILL.md')

  if (!fs.existsSync(skill.path)) {
    issues.push('Skill 目录不存在')
  }
  if (!fs.existsSync(skillMdPath)) {
    issues.push('缺少 SKILL.md')
  }
  if (!skill.description || !skill.description.trim()) {
    suggestions.push('description 为空，建议补充说明以提升可读性')
  }

  const metadata = (skill.metadata || {}) as {
    providers?: unknown
    tags?: unknown
    intents?: unknown
  }
  const providers = Array.isArray(metadata.providers)
    ? metadata.providers.map((item: unknown) => String(item).toLowerCase())
    : []
  if (!Array.isArray(metadata.tags) || metadata.tags.length === 0) {
    suggestions.push('未声明 tags，建议补充标签以提升路由准确率')
  }
  if (!Array.isArray(metadata.intents) || metadata.intents.length === 0) {
    suggestions.push('未声明 intents，建议补充意图词')
  }
  if (activeProvider && providers.length > 0 && !providers.includes(activeProvider.toLowerCase())) {
    warnings.push(`当前 Provider(${activeProvider}) 未在技能 providers 中声明`)
  }

  const status: SkillHealthStatus = issues.length > 0
    ? 'broken'
    : warnings.length > 0
      ? 'warning'
      : 'healthy'

  return { status, issues, warnings, suggestions }
}

function isGitHubSource(source: SkillSourceConfig | undefined): boolean {
  return Boolean(source && source.type === 'git' && /github\.com[:/]/i.test(source.location))
}

function buildGitHubSourceConfig(owner: string, repo: string, branch: string): SkillSourceConfig {
  const now = Date.now()
  return {
    id: `source_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${owner}/${repo}`,
    type: 'git',
    location: `https://github.com/${owner}/${repo}.git`,
    branch: branch || undefined,
    trusted: true,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

function ensureGitHubSkillSource(
  currentSettings: Settings | null,
  owner: string,
  repo: string,
  branch?: string,
): { sourceId?: string; nextSettings?: Settings } {
  if (!currentSettings) {
    return {}
  }

  const currentSkills = normalizeSkillSettings(currentSettings.skills)
  const sources = currentSkills.sources || []
  const location = `https://github.com/${owner}/${repo}.git`
  const existing = sources.find((source) => (
    source.type === 'git'
    && source.location === location
    && (source.branch || '') === (branch || '')
  ))

  if (existing) {
    return { sourceId: existing.id }
  }

  const source = buildGitHubSourceConfig(owner, repo, branch || '')
  const nextSettings: Settings = {
    ...currentSettings,
    skills: normalizeSkillSettings({
      ...currentSkills,
      sources: [...sources, source],
    }),
  }

  return {
    sourceId: source.id,
    nextSettings,
  }
}

/**
 * GET /api/settings - Get current settings
 * 返回完整的 settings 配置，包括所有 providers 和当前生效的 provider
 */
settingsRoutes.get('/', (c) => {
  const settingsCache = getSettings()
  if (!settingsCache) {
    // Return default settings
    return c.json({
      activeProviderId: null,
      providers: [],
      mcp: { enabled: false, mcpServers: {} },
      skills: getDefaultSkillsSettings(),
      approval: getDefaultApprovalSettings(),
      sandbox: getDefaultSandboxSettings(),
    })
  }

  // 返回所有 providers（隐藏 API Key）
  const sanitizedProviders = settingsCache.providers?.map(p => ({
    ...p,
    apiKey: p.apiKey ? '***configured***' : '',
  })) || []

  return c.json({
    activeProviderId: settingsCache.activeProviderId,
    providers: sanitizedProviders,
    mcp: settingsCache.mcp || { enabled: false, mcpServers: {} },
    skills: normalizeSkillSettings(settingsCache.skills),
    approval: normalizeApprovalSettings(settingsCache.approval),
    sandbox: normalizeSandboxSettings(settingsCache.sandbox),
  })
})

settingsRoutes.get('/runtime', (c) => {
  return c.json({
    workDir: deps.workDir,
    projectRoot: getProjectRoot(),
  })
})

/**
 * GET /api/settings/providers - 获取所有 Provider 配置列表
 */
settingsRoutes.get('/providers', (c) => {
  const settingsCache = getSettings()
  if (!settingsCache) {
    return c.json({ providers: [], activeProviderId: null })
  }

  // 返回所有 providers（隐藏 API Key）
  const sanitizedProviders = settingsCache.providers?.map(p => ({
    ...p,
    apiKey: p.apiKey ? '***configured***' : '',
  })) || []

  return c.json({
    providers: sanitizedProviders,
    activeProviderId: settingsCache.activeProviderId,
  })
})

/**
 * POST /api/settings/providers - 添加新的 Provider 配置
 */
settingsRoutes.post('/providers', async (c) => {
  try {
    const body = await c.req.json()
    const { name, provider, apiKey, model, baseUrl } = body

    // 验证必填字段
    if (!name || !provider || !apiKey || !model) {
      return c.json({ error: 'name, provider, apiKey, and model are required' }, 400)
    }

    const currentSettings = getSettings()
    const settings: Settings = currentSettings || {
      activeProviderId: null,
      providers: [],
      mcp: { enabled: false, mcpServers: {} },
      skills: getDefaultSkillsSettings(),
      approval: getDefaultApprovalSettings(),
      sandbox: getDefaultSandboxSettings(),
    }

    // 创建新的 Provider 配置
    const newProvider: ProviderConfigItem = {
      id: `provider_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      name,
      provider,
      apiKey,
      model,
      baseUrl,
      enabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    settings.providers = [...(settings.providers || []), newProvider]

    // 如果是第一个 provider，自动设为 active
    if (settings.providers.length === 1) {
      settings.activeProviderId = newProvider.id
      newProvider.enabled = true
    }

    // 保存设置
    setSettings(settings)
    saveSettingsToFile(settings)

    // 如果这是首个 provider，保存后立即初始化运行时 AgentService，
    // 避免用户首次配置完成后仍命中“未初始化 Agent 服务”错误。
    if (settings.activeProviderId === newProvider.id && newProvider.enabled) {
      const success = recreateAgentService(newProvider, deps)
      if (!success) {
        return c.json({ error: 'Failed to initialize provider runtime' }, 500)
      }
    }

    return c.json({
      success: true,
      provider: {
        ...newProvider,
        apiKey: '***configured***',
      },
    })
  } catch (error) {
    log.error(error, 'Failed to add provider')
    return c.json({ error: 'Failed to add provider' }, 500)
  }
})

/**
 * POST /api/settings/providers/:id/activate - 激活指定的 Provider
 * 注意：具体路由必须放在参数路由 /providers/:id 之前
 */
settingsRoutes.post('/providers/:id/activate', async (c) => {
  try {
    const id = c.req.param('id')

    const currentSettings = getSettings()
    if (!currentSettings || !currentSettings.providers) {
      return c.json({ error: 'Settings not found' }, 404)
    }

    const provider = currentSettings.providers.find(p => p.id === id)
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404)
    }

    // 设置 active provider
    currentSettings.activeProviderId = id
    currentSettings.providers.forEach(p => {
      p.enabled = (p.id === id)
    })

    // 保存设置
    setSettings(currentSettings)
    saveSettingsToFile(currentSettings)

    // 重新创建 agent service
    const success = recreateAgentService(provider, deps)

    if (!success) {
      return c.json({ error: 'Failed to activate provider' }, 500)
    }

    return c.json({
      success: true,
      provider: {
        ...provider,
        apiKey: '***configured***',
      },
    })
  } catch (error) {
    log.error(error, 'Failed to activate provider')
    return c.json({ error: 'Failed to activate provider' }, 500)
  }
})

/**
 * POST /api/settings/providers/:id/test - 测试 Provider 配置
 * 发送一个简单的请求验证配置是否正确
 * 注意：具体路由必须放在参数路由 /providers/:id 之前
 */
settingsRoutes.post('/providers/:id/test', async (c) => {
  try {
    const id = c.req.param('id')

    const currentSettings = getSettings()
    if (!currentSettings || !currentSettings.providers) {
      return c.json({ error: 'Settings not found' }, 404)
    }

    const provider = currentSettings.providers.find(p => p.id === id)
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404)
    }

    // 执行测试
    const testResult = await testProviderConfig(provider)

    return c.json(testResult)
  } catch (error) {
    log.error(error, 'Failed to test provider')
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '测试失败',
      details: '测试过程中发生错误'
    }, 500)
  }
})

/**
 * PUT /api/settings/providers/:id - 更新 Provider 配置
 */
settingsRoutes.put('/providers/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { name, provider, apiKey, model, baseUrl } = body

    const currentSettings = getSettings()
    if (!currentSettings || !currentSettings.providers) {
      return c.json({ error: 'Settings not found' }, 404)
    }

    const providerIndex = currentSettings.providers.findIndex(p => p.id === id)
    if (providerIndex === -1) {
      return c.json({ error: 'Provider not found' }, 404)
    }

    // 更新 provider 配置
    const existingProvider = currentSettings.providers[providerIndex]
    const updatedProvider: ProviderConfigItem = {
      ...existingProvider,
      name: name || existingProvider.name,
      provider: provider || existingProvider.provider,
      model: model || existingProvider.model,
      baseUrl: baseUrl !== undefined ? baseUrl : existingProvider.baseUrl,
      updatedAt: Date.now(),
    }

    // 如果 apiKey 不是占位符，则更新
    if (apiKey && apiKey !== '***configured***') {
      updatedProvider.apiKey = apiKey
    }

    currentSettings.providers[providerIndex] = updatedProvider

    // 保存设置
    setSettings(currentSettings)
    saveSettingsToFile(currentSettings)

    // 如果更新的是当前 active provider，需要重新创建 agent service
    if (currentSettings.activeProviderId === id) {
      recreateAgentService(updatedProvider, deps)
    }

    return c.json({
      success: true,
      provider: {
        ...updatedProvider,
        apiKey: '***configured***',
      },
    })
  } catch (error) {
    log.error(error, 'Failed to update provider')
    return c.json({ error: 'Failed to update provider' }, 500)
  }
})

/**
 * DELETE /api/settings/providers/:id - 删除 Provider 配置
 */
settingsRoutes.delete('/providers/:id', async (c) => {
  try {
    const id = c.req.param('id')

    const currentSettings = getSettings()
    if (!currentSettings || !currentSettings.providers) {
      return c.json({ error: 'Settings not found' }, 404)
    }

    const providerIndex = currentSettings.providers.findIndex(p => p.id === id)
    if (providerIndex === -1) {
      return c.json({ error: 'Provider not found' }, 404)
    }

    // 删除 provider
    currentSettings.providers.splice(providerIndex, 1)

    // 如果删除的是当前 active provider，需要重新选择
    if (currentSettings.activeProviderId === id) {
      currentSettings.activeProviderId = currentSettings.providers.length > 0
        ? currentSettings.providers[0].id
        : null
      if (currentSettings.activeProviderId) {
        const newActive = currentSettings.providers.find(p => p.id === currentSettings.activeProviderId)
        if (newActive) newActive.enabled = true
      }
    }

    // 保存设置
    setSettings(currentSettings)
    saveSettingsToFile(currentSettings)

    return c.json({ success: true })
  } catch (error) {
    log.error(error, 'Failed to delete provider')
    return c.json({ error: 'Failed to delete provider' }, 500)
  }
})

/**
 * 重新创建 Agent Service
 */
function recreateAgentService(provider: ProviderConfigItem, deps: SettingsRouteDeps): boolean {
  try {
    const workDir = deps.workDir

    const maskedApiKey = provider.apiKey
      ? `${provider.apiKey.slice(0, 8)}...${provider.apiKey.slice(-4)}`
      : '(empty)'

    // 获取当前 skills 配置
    const settings = getSettings()
    const skillsConfig = {
      enabled: settings?.skills?.enabled !== false,
      userDirEnabled: false,  // 不使用用户目录的 skills
      appDirEnabled: true,    // 使用项目目录的 skills
    }
    const mcpConfig = buildRuntimeMcpConfig(settings || undefined)

    const sandboxSettings = normalizeSandboxSettings(settings?.sandbox)
    const sandboxConfig = sandboxSettings.enabled
      ? {
          enabled: true,
          provider: sandboxSettings.provider,
          image: sandboxSettings.image,
          apiEndpoint: sandboxSettings.apiEndpoint,
        }
      : undefined

    log.info({
      provider: provider.provider,
      model: provider.model,
      baseUrl: provider.baseUrl,
      apiKey: maskedApiKey,
      skills: skillsConfig.enabled ? 'enabled' : 'disabled',
      mcp: mcpConfig ? 'enabled' : 'disabled',
      sandbox: sandboxConfig ? 'enabled' : 'disabled',
    }, 'Recreating agent service')

    const agentServiceConfig: AgentServiceConfig = {
      provider: {
        provider: provider.provider as 'claude' | 'glm' | 'openai' | 'openrouter' | 'kimi' | 'deepseek',
        apiKey: provider.apiKey,
        model: provider.model,
        baseUrl: provider.baseUrl,
      },
      workDir,
      skills: skillsConfig,
      mcp: mcpConfig,
      sandbox: sandboxConfig,
    }

    const agentService = createAgentService(
      agentServiceConfig.provider,
      workDir,
      skillsConfig,
      mcpConfig,
      sandboxConfig
    )

    deps.setAgentRuntimeState({
      agentService,
      agentServiceConfig,
    })
    log.info('Agent service recreated successfully')
    return true
  } catch (err) {
    log.error(err, 'Failed to recreate agent service')
    return false
  }
}

/**
 * 测试 Provider 配置
 * 参考 cc-switch 实现：使用流式请求，固定轻量级模型，自动添加 API 路径
 */
async function testProviderConfig(provider: ProviderConfigItem): Promise<{
  success: boolean
  error?: string
  details?: string
  latency?: number
  model?: string
}> {
  const startTime = Date.now()

  try {
    const apiKey = provider.apiKey

    if (!apiKey) {
      return { success: false, error: 'API Key 未配置' }
    }

    // 使用用户配置的模型进行测试
    const testModel = provider.model || getTestModel(provider.provider)

    // 构建测试请求的 body（流式）
    const requestBody = buildTestRequest(provider.provider, testModel, provider.baseUrl)
    const headers = buildTestHeaders(provider.provider, apiKey, provider.baseUrl)
    const endpoint = buildTestEndpoint(provider.provider, provider.baseUrl)

    log.debug({ provider: provider.provider, endpoint, model: testModel }, 'Testing provider')

    // 发送流式测试请求
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    const latency = Date.now() - startTime

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}`

      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }

      return {
        success: false,
        error: '请求失败',
        details: errorMessage,
        latency,
      }
    }

    // 对于流式响应，读取第一个 chunk 即可判定成功
    const reader = response.body?.getReader()
    if (reader) {
      const { done } = await reader.read()
      if (!done) {
        reader.cancel() // 取消剩余流，只需第一个 chunk
      }
    }

    return {
      success: true,
      latency,
      model: testModel,
      details: `连接成功，延迟 ${latency}ms`,
    }
  } catch (error) {
    const latency = Date.now() - startTime
    return {
      success: false,
      error: '连接失败',
      details: error instanceof Error ? error.message : '未知错误',
      latency,
    }
  }
}

/**
 * 获取测试用的轻量级模型（参考 cc-switch）
 */
function getTestModel(provider: string): string {
  const testModels: Record<string, string> = {
    // Claude: 使用轻量级模型
    claude: 'claude-3-haiku-20240307',
    // OpenAI: 使用轻量级模型
    openai: 'gpt-4o-mini',
    // DeepSeek: 使用轻量级模型
    deepseek: 'deepseek-chat',
    // GLM: 使用轻量级模型
    glm: 'glm-4-flash',
    // Kimi: 使用轻量级模型
    kimi: 'moonshot-v1-8k',
    // OpenRouter: 使用轻量级模型
    openrouter: 'openai/gpt-4o-mini',
  }
  return testModels[provider] || 'gpt-4o-mini'
}

/**
 * 获取默认 Base URL（仅用于构建完整 endpoint）
 */
function getDefaultBaseUrl(provider: string): string {
  const defaults: Record<string, string> = {
    claude: 'https://api.anthropic.com',
    glm: 'https://open.bigmodel.cn/api/paas',
    openai: 'https://api.openai.com',
    openrouter: 'https://openrouter.ai/api',
    kimi: 'https://api.moonshot.cn',
    deepseek: 'https://api.deepseek.com',
  }
  return defaults[provider] || ''
}

/**
 * 构建测试请求的 headers（参考 cc-switch 的 CLI 模拟）
 */
function buildTestHeaders(provider: string, apiKey: string, baseUrl?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
  }

  switch (provider) {
    case 'claude':
      // 参考 cc-switch: Anthropic 官方 API 格式
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14'
      headers['Authorization'] = `Bearer ${apiKey}`
      headers['User-Agent'] = 'claude-cli/2.1.2 (external, cli)'
      break
    case 'openai':
      // OpenAI 官方格式
      headers['Authorization'] = `Bearer ${apiKey}`
      headers['User-Agent'] = 'OpenAI-CLI/1.0.0'
      break
    case 'kimi':
      // Kimi For Coding 使用 Anthropic 格式
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14'
      headers['Authorization'] = `Bearer ${apiKey}`
      headers['User-Agent'] = 'claude-cli/2.1.2 (external, cli)'
      break
    case 'glm':
      // GLM: 检测是否使用 Anthropic 格式
      if (baseUrl?.includes('/anthropic')) {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
        headers['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14'
        headers['Authorization'] = `Bearer ${apiKey}`
        headers['User-Agent'] = 'claude-cli/2.1.2 (external, cli)'
      } else {
        // OpenAI 兼容格式
        headers['Authorization'] = `Bearer ${apiKey}`
      }
      break
    case 'deepseek':
    case 'openrouter':
    default:
      // OpenAI 兼容格式
      headers['Authorization'] = `Bearer ${apiKey}`
      break
  }

  return headers
}

/**
 * 构建测试请求的 endpoint（参考 cc-switch：自动添加 API 路径）
 */
function buildTestEndpoint(provider: string, baseUrl: string | undefined): string {
  // 使用配置的 baseUrl 或默认 baseUrl
  const base = baseUrl || getDefaultBaseUrl(provider)
  // 移除末尾的斜杠
  const url = base.replace(/\/$/, '')

  switch (provider) {
    case 'claude':
      // 参考 cc-switch: 自动添加 /v1/messages
      if (url.endsWith('/v1')) {
        return `${url}/messages?beta=true`
      }
      return `${url}/v1/messages?beta=true`
    case 'kimi':
      // Kimi For Coding 使用 Anthropic 格式
      if (url.includes('/coding')) {
        if (url.endsWith('/v1')) {
          return `${url}/messages?beta=true`
        }
        return `${url}/v1/messages?beta=true`
      }
      // 普通 Kimi 使用 OpenAI 格式
      if (url.endsWith('/v1')) {
        return `${url}/chat/completions`
      }
      return `${url}/v1/chat/completions`
    case 'glm':
      // GLM: 检测是否使用 Anthropic 格式
      if (url.includes('/anthropic')) {
        if (url.endsWith('/v1')) {
          return `${url}/messages?beta=true`
        }
        return `${url}/v1/messages?beta=true`
      }
      // 普通 GLM 使用 OpenAI 格式
      if (url.endsWith('/v1')) {
        return `${url}/chat/completions`
      }
      return `${url}/v1/chat/completions`
    case 'openai':
    case 'deepseek':
    case 'openrouter':
    default:
      // OpenAI 兼容格式: 自动添加 /v1/chat/completions
      if (url.endsWith('/v1')) {
        return `${url}/chat/completions`
      }
      return `${url}/v1/chat/completions`
  }
}

/**
 * 构建测试请求的 body（参考 cc-switch：流式请求，轻量级 prompt）
 */
function buildTestRequest(provider: string, model: string, baseUrl?: string): unknown {
  // 参考 cc-switch: 使用简单的测试 prompt
  const testMessage = 'Who are you?'

  switch (provider) {
    case 'claude':
      return {
        model,
        max_tokens: 1,
        messages: [
          { role: 'user', content: testMessage }
        ],
        stream: true,
      }
    case 'kimi':
      // Kimi For Coding 使用 Anthropic 格式
      return {
        model,
        max_tokens: 1,
        messages: [
          { role: 'user', content: testMessage }
        ],
        stream: true,
      }
    case 'glm':
      // GLM: 检测是否使用 Anthropic 格式
      if (baseUrl?.includes('/anthropic')) {
        return {
          model,
          max_tokens: 1,
          messages: [
            { role: 'user', content: testMessage }
          ],
          stream: true,
        }
      }
      // 普通 GLM 使用 OpenAI 格式
      return {
        model,
        max_tokens: 1,
        messages: [
          { role: 'user', content: testMessage }
        ],
        stream: true,
        temperature: 0,
      }
    case 'openai':
    case 'deepseek':
    case 'openrouter':
    default:
      return {
        model,
        max_tokens: 1,
        messages: [
          { role: 'user', content: testMessage }
        ],
        stream: true,
        temperature: 0,
      }
  }
}

/**
 * GET /api/settings/mcp - Get MCP settings
 */
settingsRoutes.get('/mcp', (c) => {
  const settingsCache = getSettings()
  return c.json(settingsCache?.mcp || { enabled: false, mcpServers: {} })
})

/**
 * POST /api/settings/mcp - Save MCP settings
 */
settingsRoutes.post('/mcp', async (c) => {
  try {
    const body = await c.req.json()
    const { enabled, mcpServers } = body as McpSettings

    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const newMcpSettings: McpSettings = {
      enabled: enabled ?? false,
      mcpServers: mcpServers || {},
    }

    const newSettings: Settings = {
      ...currentSettings,
      mcp: newMcpSettings,
    }

    setSettings(newSettings)
    saveSettingsToFile(newSettings)

    const activeProvider = getActiveProviderConfig()
    if (activeProvider?.apiKey) {
      recreateAgentService(activeProvider, deps)
    }

    return c.json({ success: true, mcp: newMcpSettings })
  } catch (error) {
    log.error(error, 'Failed to save MCP settings')
    return c.json({ error: 'Failed to save MCP settings' }, 500)
  }
})

/**
 * GET /api/settings/sandbox - Get sandbox settings
 */
settingsRoutes.get('/sandbox', (c) => {
  const settingsCache = getSettings()
  return c.json(normalizeSandboxSettings(settingsCache?.sandbox))
})

/**
 * POST /api/settings/sandbox - Save sandbox settings
 */
settingsRoutes.post('/sandbox', async (c) => {
  try {
    const body = await c.req.json()
    const currentSettings = getSettings() || {
      activeProviderId: null,
      providers: [],
      mcp: { enabled: false, mcpServers: {} },
      skills: getDefaultSkillsSettings(),
      approval: getDefaultApprovalSettings(),
      sandbox: getDefaultSandboxSettings(),
    }

    const nextSandbox = normalizeSandboxSettings({
      ...(currentSettings.sandbox || getDefaultSandboxSettings()),
      ...((body || {}) as SandboxSettings),
    })

    const newSettings: Settings = {
      ...currentSettings,
      sandbox: nextSandbox,
    }

    setSettings(newSettings)
    saveSettingsToFile(newSettings)

    const activeProvider = getActiveProviderConfig()
    if (activeProvider?.apiKey) {
      recreateAgentService(activeProvider, deps)
    }

    return c.json({ success: true, sandbox: nextSandbox })
  } catch (error) {
    log.error(error, 'Failed to save sandbox settings')
    return c.json({ error: 'Failed to save sandbox settings' }, 500)
  }
})

/**
 * GET /api/settings/approval - Get approval settings
 */
settingsRoutes.get('/approval', (c) => {
  const settingsCache = getSettings()
  return c.json(normalizeApprovalSettings(settingsCache?.approval))
})

/**
 * POST /api/settings/approval - Save approval settings
 */
settingsRoutes.post('/approval', async (c) => {
  try {
    const body = await c.req.json()
    const currentSettings = getSettings() || {
      activeProviderId: null,
      providers: [],
      mcp: { enabled: false, mcpServers: {} },
      skills: getDefaultSkillsSettings(),
      approval: getDefaultApprovalSettings(),
      sandbox: getDefaultSandboxSettings(),
    }

    const nextApproval = normalizeApprovalSettings({
      ...(currentSettings.approval || getDefaultApprovalSettings()),
      ...(body || {}),
    })

    const newSettings: Settings = {
      ...currentSettings,
      approval: nextApproval,
    }

    setSettings(newSettings)
    saveSettingsToFile(newSettings)

    return c.json({ success: true, approval: nextApproval })
  } catch (error) {
    log.error(error, 'Failed to save approval settings')
    return c.json({ error: 'Failed to save approval settings' }, 500)
  }
})

/**
 * GET /api/settings/skills - Get Skills settings
 */
settingsRoutes.get('/skills', (c) => {
  const settingsCache = getSettings()
  return c.json(normalizeSkillSettings(settingsCache?.skills))
})

/**
 * POST /api/settings/skills - Save Skills settings
 */
settingsRoutes.post('/skills', async (c) => {
  try {
    const body = await c.req.json()
    const {
      enabled,
      skills,
      routing,
      sources,
    } = body as SkillSettings

    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const nextSettings = normalizeSkillSettings({
      ...currentSettings.skills,
      enabled: enabled ?? currentSettings.skills?.enabled ?? true,
      skills: skills ?? currentSettings.skills?.skills,
      routing: routing ?? currentSettings.skills?.routing,
      sources: sources ?? currentSettings.skills?.sources,
    })

    const newSettings: Settings = {
      ...currentSettings,
      skills: nextSettings,
    }

    setSettings(newSettings)
    saveSettingsToFile(newSettings)

    return c.json({ success: true, skills: nextSettings })
  } catch (error) {
    log.error(error, 'Failed to save Skills settings')
    return c.json({ error: 'Failed to save Skills settings' }, 500)
  }
})

/**
 * GET /api/settings/skills/routing - 获取自动路由配置
 */
settingsRoutes.get('/skills/routing', (c) => {
  const settingsCache = getSettings()
  const routing = settingsCache?.skills?.routing || getDefaultSkillRoutingSettings()
  return c.json(routing)
})

/**
 * POST /api/settings/skills/routing - 保存自动路由配置
 */
settingsRoutes.post('/skills/routing', async (c) => {
  try {
    const body = await c.req.json()
    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const nextSkills = normalizeSkillSettings({
      enabled: currentSettings.skills?.enabled ?? true,
      skills: currentSettings.skills?.skills,
      sources: currentSettings.skills?.sources,
      routing: {
        ...(currentSettings.skills?.routing || getDefaultSkillRoutingSettings()),
        ...(body || {}),
      },
    })

    const newSettings: Settings = {
      ...currentSettings,
      skills: nextSkills,
    }

    setSettings(newSettings)
    saveSettingsToFile(newSettings)

    return c.json({ success: true, routing: nextSkills.routing })
  } catch (error) {
    log.error(error, 'Failed to save skills routing settings')
    return c.json({ error: 'Failed to save skills routing settings' }, 500)
  }
})

/**
 * POST /api/settings/skills/route/preview - 预览技能路由结果
 */
settingsRoutes.post('/skills/route/preview', async (c) => {
  try {
    const body = await c.req.json()
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const providerFromBody = typeof body?.provider === 'string' ? body.provider : undefined

    if (!prompt) {
      return c.json({ error: 'prompt is required' }, 400)
    }

    const activeProvider = getActiveProviderConfig()
    const provider = providerFromBody || activeProvider?.provider || 'claude'
    const settings = getSettings()
    const projectRoot = getProjectRoot()

    const routed = routeSkillsForPrompt({
      prompt,
      provider,
      projectRoot,
      skillsSettings: settings?.skills,
      includeExplain: true,
    })

    return c.json({
      success: true,
      provider,
      routing: routed.routing,
      selected: routed.selected,
      fallbackUsed: routed.fallbackUsed,
      candidates: routed.candidateCount,
      elapsedMs: routed.elapsedMs,
    })
  } catch (error) {
    log.error(error, 'Failed to preview skill route')
    return c.json({ error: 'Failed to preview skill route' }, 500)
  }
})

/**
 * POST /api/settings/skills/route/recommend-plan - 基于路由结果返回推荐计划草案
 */
settingsRoutes.post('/skills/route/recommend-plan', async (c) => {
  try {
    const body = await c.req.json()
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const providerFromBody = typeof body?.provider === 'string' ? body.provider : undefined

    if (!prompt) {
      return c.json({ error: 'prompt is required' }, 400)
    }

    const activeProvider = getActiveProviderConfig()
    const provider = providerFromBody || activeProvider?.provider || 'claude'
    const settings = getSettings()
    const projectRoot = getProjectRoot()
    const routed = routeSkillsForPrompt({
      prompt,
      provider,
      projectRoot,
      skillsSettings: settings?.skills,
      includeExplain: true,
    })

    const skillNames = routed.selected.slice(0, 3).map((item) => item.name)
    const steps = [
      '明确任务目标与约束',
      skillNames.length > 0
        ? `按路由优先使用技能: ${skillNames.join('、')}`
        : '执行通用分析与信息整理',
      '生成结构化结果并自检',
    ]

    return c.json({
      success: true,
      provider,
      routing: routed.routing,
      selected: routed.selected,
      fallbackUsed: routed.fallbackUsed,
      recommendedPlan: {
        goal: prompt,
        steps,
        notes: '可在计划编辑器中继续修改后执行',
      },
    })
  } catch (error) {
    log.error(error, 'Failed to build recommended plan')
    return c.json({ error: 'Failed to build recommended plan' }, 500)
  }
})

/**
 * GET /api/settings/skills/sources - 获取来源列表
 */
settingsRoutes.get('/skills/sources', (c) => {
  const settings = getSettings()
  const skills = normalizeSkillSettings(settings?.skills)
  return c.json({
    success: true,
    sources: skills.sources || [],
  })
})

/**
 * POST /api/settings/skills/sources - 新增来源
 */
settingsRoutes.post('/skills/sources', async (c) => {
  try {
    const body = await c.req.json()
    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const type = typeof body?.type === 'string' ? body.type : ''
    const location = typeof body?.location === 'string' ? body.location.trim() : ''

    if (!name || !location || !['local', 'git', 'http'].includes(type)) {
      return c.json({ error: 'name, type(local|git|http), location are required' }, 400)
    }

    const currentSkills = normalizeSkillSettings(currentSettings.skills)
    const now = Date.now()
    const source = {
      id: `source_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: type as 'local' | 'git' | 'http',
      location,
      branch: typeof body?.branch === 'string' ? body.branch : undefined,
      authRef: typeof body?.authRef === 'string' ? body.authRef : undefined,
      trusted: Boolean(body?.trusted),
      enabled: body?.enabled !== false,
      createdAt: now,
      updatedAt: now,
    }

    const nextSkills = normalizeSkillSettings({
      ...currentSkills,
      sources: [...(currentSkills.sources || []), source],
    })
    const nextSettings: Settings = {
      ...currentSettings,
      skills: nextSkills,
    }

    setSettings(nextSettings)
    saveSettingsToFile(nextSettings)

    return c.json({
      success: true,
      source,
    })
  } catch (error) {
    log.error(error, 'Failed to add skill source')
    return c.json({ error: 'Failed to add skill source' }, 500)
  }
})

/**
 * DELETE /api/settings/skills/sources/:id - 删除来源
 */
settingsRoutes.delete('/skills/sources/:id', (c) => {
  try {
    const sourceId = c.req.param('id')
    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const currentSkills = normalizeSkillSettings(currentSettings.skills)
    const sources = currentSkills.sources || []
    if (!sources.some((item) => item.id === sourceId)) {
      return c.json({ error: 'Source not found' }, 404)
    }

    const nextSkills = normalizeSkillSettings({
      ...currentSkills,
      sources: sources.filter((item) => item.id !== sourceId),
    })
    const nextSettings: Settings = {
      ...currentSettings,
      skills: nextSkills,
    }

    setSettings(nextSettings)
    saveSettingsToFile(nextSettings)

    return c.json({ success: true })
  } catch (error) {
    log.error(error, 'Failed to delete skill source')
    return c.json({ error: 'Failed to delete skill source' }, 500)
  }
})

/**
 * POST /api/settings/skills/install - 从来源安装技能
 */
settingsRoutes.post('/skills/install', async (c) => {
  try {
    const body = await c.req.json()
    const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : ''
    const skillName = typeof body?.skillName === 'string' ? body.skillName.trim() : undefined

    if (!sourceId) {
      return c.json({ error: 'sourceId is required' }, 400)
    }

    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const skillsSettings = normalizeSkillSettings(currentSettings.skills)
    const source = validateSourceForInstall(skillsSettings.sources || [], sourceId)
    const installed = await installSkillFromSource(source, getProjectRoot(), skillName)
    upsertSkillSourceBindings(
      getProjectRoot(),
      Object.fromEntries(installed.map((item) => [item.skillId, item.sourceId]))
    )

    return c.json({
      success: true,
      installed,
      count: installed.length,
    })
  } catch (error) {
    log.error(error, 'Failed to install skills from source')
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to install skills from source',
    }, 500)
  }
})

/**
 * POST /api/settings/skills/:skillId/update - 更新单个技能
 */
settingsRoutes.post('/skills/:skillId/update', async (c) => {
  try {
    const skillId = c.req.param('skillId')
    const body = await c.req.json().catch(() => ({}))
    const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : undefined
    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const skillsSettings = normalizeSkillSettings(currentSettings.skills)
    const updated = await updateSkillFromSources(
      skillId,
      skillsSettings.sources || [],
      getProjectRoot(),
      sourceId
    )
    upsertSkillSourceBindings(getProjectRoot(), { [updated.skillId]: updated.sourceId })

    return c.json({
      success: true,
      result: updated,
    })
  } catch (error) {
    log.error(error, 'Failed to update skill from source')
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to update skill from source',
    }, 500)
  }
})

/**
 * POST /api/settings/skills/:skillId/repair - 修复单个技能
 */
settingsRoutes.post('/skills/:skillId/repair', async (c) => {
  try {
    const skillId = c.req.param('skillId')
    const body = await c.req.json().catch(() => ({}))
    const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : undefined
    const currentSettings = getSettings()
    if (!currentSettings) {
      return c.json({ error: 'Main settings not configured' }, 400)
    }

    const skillsSettings = normalizeSkillSettings(currentSettings.skills)
    const repaired = await repairSkillFromSources(
      skillId,
      skillsSettings.sources || [],
      getProjectRoot(),
      sourceId
    )
    upsertSkillSourceBindings(getProjectRoot(), { [repaired.skillId]: repaired.sourceId })

    return c.json({
      success: true,
      result: repaired,
    })
  } catch (error) {
    log.error(error, 'Failed to repair skill from source')
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to repair skill from source',
    }, 500)
  }
})

/**
 * GET /api/settings/skills/:skillId/health - 查询技能健康状态
 */
settingsRoutes.get('/skills/:skillId/health', (c) => {
  try {
    const skillId = c.req.param('skillId')
    const projectRoot = getProjectRoot()
    const skills = getAllSkills(projectRoot)
    const skill = skills.find((item) => item.id === skillId)
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    const activeProvider = getActiveProviderConfig()
    const health = inspectSkillHealth(skill, activeProvider?.provider)

    return c.json({
      success: true,
      skillId: skill.id,
      name: skill.name,
      status: health.status,
      issues: health.issues,
      warnings: health.warnings,
      suggestions: health.suggestions,
    })
  } catch (error) {
    log.error(error, 'Failed to inspect skill health')
    return c.json({ error: 'Failed to inspect skill health' }, 500)
  }
})

/**
 * GET /api/settings/skills/diagnostics - 全量技能诊断
 */
settingsRoutes.get('/skills/diagnostics', (c) => {
  try {
    const projectRoot = getProjectRoot()
    const skills = getAllSkills(projectRoot)
    const activeProvider = getActiveProviderConfig()

    const diagnostics = skills.map((skill) => {
      const health = inspectSkillHealth(skill, activeProvider?.provider)
      return {
        skillId: skill.id,
        name: skill.name,
        status: health.status,
        issues: health.issues,
        warnings: health.warnings,
        suggestions: health.suggestions,
      }
    })

    return c.json({
      success: true,
      summary: {
        total: diagnostics.length,
        healthy: diagnostics.filter((item) => item.status === 'healthy').length,
        warning: diagnostics.filter((item) => item.status === 'warning').length,
        broken: diagnostics.filter((item) => item.status === 'broken').length,
      },
      diagnostics,
    })
  } catch (error) {
    log.error(error, 'Failed to run skill diagnostics')
    return c.json({ error: 'Failed to run skill diagnostics' }, 500)
  }
})

/**
 * GET /api/settings/skills/list - Get all installed skills
 * 现在只从项目 SKILLs/ 目录加载
 */
settingsRoutes.get('/skills/list', (c) => {
  try {
    const projectRoot = getProjectRoot()
    const skills = getAllSkills(projectRoot)
    const stats = getSkillsStats(projectRoot)
    const bindings = loadSkillSourceBindings(projectRoot)
    const sources = normalizeSkillSettings(getSettings()?.skills).sources || []
    const sourceById = new Map(sources.map((source) => [source.id, source]))

    return c.json({
      skills: skills.map((skill) => {
        const sourceId = bindings[skill.id]
        const source = sourceId ? sourceById.get(sourceId) : undefined
        return {
          ...skill,
          sourceInfo: sourceId && source ? {
            sourceId,
            name: source.name,
            type: source.type,
            location: source.location,
            branch: source.branch,
            canUpdate: isGitHubSource(source),
            canRepair: isGitHubSource(source),
          } : undefined,
        }
      }),
      stats,
    })
  } catch (error) {
    log.error(error, 'Failed to get skills list')
    return c.json({ error: 'Failed to get skills list' }, 500)
  }
})

/**
 * POST /api/settings/skills/import/analyze - Analyze a GitHub URL before import
 */
settingsRoutes.post('/skills/import/analyze', async (c) => {
  try {
    const body = await c.req.json()
    const { path: importPath } = body

    if (!importPath) {
      return c.json({ error: 'Path or URL is required' }, 400)
    }

    if (!importPath.startsWith('http://') && !importPath.startsWith('https://')) {
      return c.json({ error: 'GitHub URL is required for analysis' }, 400)
    }

    const { analyzeGitHubSkillSource } = await import('../services/github-skill-importer')
    const analysis = await analyzeGitHubSkillSource(importPath)

    return c.json(analysis)
  } catch (error) {
    log.error(error, 'Failed to analyze GitHub skill import')
    const errorMessage = error instanceof Error ? error.message : 'Failed to analyze GitHub skill import'
    return c.json({ error: errorMessage }, 500)
  }
})

/**
 * POST /api/settings/skills/import - Import a skill from a directory or GitHub URL to project SKILLs/
 */
settingsRoutes.post('/skills/import', async (c) => {
  try {
    const body = await c.req.json()
    const { path: importPath, skillPaths, analysisKey } = body as {
      path?: string
      skillPaths?: string[]
      analysisKey?: string
    }

    if (!importPath) {
      return c.json({ error: 'Path or URL is required' }, 400)
    }

    const projectRoot = getProjectRoot()
    const currentSettings = getSettings()
    let importedSkills: SkillInfo[] = []
    let tempDir: string | null = null
    let importedSourceId: string | undefined

    // Check if it's a GitHub URL
    if (importPath.startsWith('http://') || importPath.startsWith('https://')) {
      const { downloadSkillsFromGitHub, cleanupTempDir } = await import('../services/github-skill-importer')
      const { parseGitHubUrl } = await import('../services/github-skill-importer')
      const parsedUrl = parseGitHubUrl(importPath)

      try {
        const downloadResult = await downloadSkillsFromGitHub(importPath, skillPaths, analysisKey)
        tempDir = downloadResult.tempRoot

        importedSkills = downloadResult.skillDirs.map((skillDir) => importSkill(skillDir, projectRoot))

        if (parsedUrl) {
          const sourceRegistration = ensureGitHubSkillSource(
            currentSettings,
            parsedUrl.owner,
            parsedUrl.repo,
            parsedUrl.branchExplicit ? parsedUrl.branch : undefined,
          )
          importedSourceId = sourceRegistration.sourceId
          if (sourceRegistration.nextSettings) {
            setSettings(sourceRegistration.nextSettings)
            saveSettingsToFile(sourceRegistration.nextSettings)
          }
        }

        if (importedSourceId) {
          upsertSkillSourceBindings(
            projectRoot,
            Object.fromEntries(importedSkills.map((skill) => [skill.id, importedSourceId!]))
          )
        }

        log.info({ count: importedSkills.length, source: importPath }, 'Imported skills from GitHub')
      } finally {
        // Cleanup temp directory
        if (tempDir) {
          cleanupTempDir(tempDir)
        }
      }
    } else {
      // Local path import
      // Validate the source directory exists
      if (!fs.existsSync(importPath)) {
        return c.json({ error: 'Source directory does not exist' }, 404)
      }

      // Check if SKILL.md exists
      const skillMdPath = path.join(importPath, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) {
        return c.json({ error: 'SKILL.md not found in the specified directory' }, 400)
      }

      // Import to project SKILLs/ directory
      importedSkills = [importSkill(importPath, projectRoot)]

      log.info({ skillName: importedSkills[0]?.name, source: importPath }, 'Imported skill from local path')
    }

    const primarySkill = importedSkills[0]
    return c.json({
      success: true,
      skill: primarySkill ? {
        id: primarySkill.id,
        name: primarySkill.name,
        source: 'project',
        path: primarySkill.path,
      } : null,
      skills: importedSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        source: 'project',
        path: skill.path,
      })),
    })
  } catch (error) {
    log.error(error, 'Failed to import skill')
    const errorMessage = error instanceof Error ? error.message : 'Failed to import skill'
    return c.json({ error: errorMessage }, 500)
  }
})

/**
 * DELETE /api/settings/skills/:id - Delete a skill from project SKILLs/
 */
settingsRoutes.delete('/skills/:id', async (c) => {
  try {
    const id = c.req.param('id')

    // Delete from project SKILLs/ directory
    const projectRoot = getProjectRoot()
    deleteSkill(id, projectRoot)
    removeSkillSourceBinding(projectRoot, id)

    log.info({ skillId: id }, 'Deleted skill')

    return c.json({ success: true })
  } catch (error) {
    log.error(error, 'Failed to delete skill')
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete skill'
    return c.json({ error: errorMessage }, 500)
  }
})

  return settingsRoutes
}

function assertSettingsRouteDeps(deps: SettingsRouteDeps | undefined): asserts deps is SettingsRouteDeps {
  if (!deps?.getAgentRuntimeState || !deps?.setAgentRuntimeState || !deps?.workDir) {
    throw new Error('createSettingsRoutes requires explicit settings route deps')
  }
}
