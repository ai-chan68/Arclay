import type { ProviderConfig } from '@shared-types'
import { getProviderConfig, getWorkDir } from '../config'
import { createSandboxService, type SandboxService } from '../core/sandbox/sandbox-service'
import type { McpConfig, SandboxConfig, SkillsConfig } from '../core/agent/types'
import { getActiveProviderConfig, getSettings, normalizeSandboxSettings } from '../settings-store'
import { createAgentService, type AgentService, type AgentServiceConfig } from '../services/agent-service'

export interface AgentRuntimeState {
  agentService: AgentService | null
  agentServiceConfig: AgentServiceConfig | null
}

export interface AppRuntime {
  readonly workDir: string
  getAgentRuntimeState(): AgentRuntimeState
  setAgentRuntimeState(state: AgentRuntimeState): void
  getSandboxService(): SandboxService | null
  initializeSandboxServices(): Promise<SandboxService>
}

export function createAppRuntime(): AppRuntime {
  const workDir = getWorkDir()
  let sandboxService: SandboxService | null = null
  let sandboxServicePromise: Promise<SandboxService> | null = null
  let agentRuntimeState = buildInitialAgentRuntimeState(workDir)

  return {
    workDir,
    getAgentRuntimeState: () => agentRuntimeState,
    setAgentRuntimeState: (state) => {
      agentRuntimeState = state
    },
    getSandboxService: () => sandboxService,
    initializeSandboxServices: () => {
      if (!sandboxServicePromise) {
        sandboxServicePromise = createSandboxService(workDir)
          .then((service) => {
            sandboxService = service
            return service
          })
          .catch((error) => {
            sandboxServicePromise = null
            throw error
          })
      }
      return sandboxServicePromise
    },
  }
}

function buildInitialAgentRuntimeState(workDir: string): AgentRuntimeState {
  const providerConfig = resolveInitialProviderConfig()
  if (!providerConfig?.apiKey) {
    return {
      agentService: null,
      agentServiceConfig: null,
    }
  }

  const agentServiceConfig: AgentServiceConfig = {
    provider: providerConfig,
    workDir,
    skills: getSkillsConfig(),
    mcp: getMcpConfig(),
    sandbox: getSandboxConfig(),
  }

  return {
    agentService: createAgentService(
      agentServiceConfig.provider,
      agentServiceConfig.workDir,
      agentServiceConfig.skills,
      agentServiceConfig.mcp,
      agentServiceConfig.sandbox,
    ),
    agentServiceConfig,
  }
}

function resolveInitialProviderConfig(): ProviderConfig | null {
  const activeProvider = getActiveProviderConfig()
  if (activeProvider?.apiKey) {
    return {
      provider: activeProvider.provider as ProviderConfig['provider'],
      apiKey: activeProvider.apiKey,
      model: activeProvider.model,
      baseUrl: activeProvider.baseUrl,
    }
  }

  try {
    return getProviderConfig()
  } catch {
    return null
  }
}

function getSkillsConfig(): SkillsConfig {
  const settings = getSettings()
  return {
    enabled: settings?.skills?.enabled !== false,
    userDirEnabled: false,
    appDirEnabled: true,
  }
}

function getMcpConfig(): McpConfig | undefined {
  const settings = getSettings()
  if (!settings?.mcp?.enabled) {
    return undefined
  }

  const mcpServers: Record<string, import('../core/agent/types').McpServerConfig> = {}
  if (settings.mcp.mcpServers) {
    for (const [name, config] of Object.entries(settings.mcp.mcpServers)) {
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
  }

  return {
    enabled: true,
    userDirEnabled: false,
    appDirEnabled: false,
    mcpServers,
  }
}

function getSandboxConfig(): SandboxConfig | undefined {
  const settings = getSettings()
  const sandbox = normalizeSandboxSettings(settings?.sandbox)
  if (!sandbox.enabled) {
    return undefined
  }

  return {
    enabled: true,
    provider: sandbox.provider,
    image: sandbox.image,
    apiEndpoint: sandbox.apiEndpoint,
  }
}
