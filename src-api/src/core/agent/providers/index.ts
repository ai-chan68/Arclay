/**
 * Agent Providers 入口
 * 注册所有内置的 Agent Provider
 */

import { agentRegistry, registerAgentPlugin } from '../registry'
import { createClaudeProvider } from './claude'
import type { AgentPlugin, IAgentProvider, AgentProviderConfig } from '../types'

/**
 * Claude Provider 插件定义
 */
const claudePlugin: AgentPlugin = {
  metadata: {
    type: 'claude',
    runtime: 'agent',
    name: 'Claude (Anthropic)',
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: true,
      supportsSystemPrompt: true,
      supportsSession: true,
      supportsPlanning: true,
      supportsParallelToolCalls: true,
      supportsSkills: true,
      supportsSandbox: true,
      supportsMcp: true,
      maxContextLength: 200000,
      supportedModels: [
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307',
      ],
    },
    defaultModel: 'claude-sonnet-4-20250514',
  },
  factory: createClaudeProvider,
}

let initialized = false

/**
 * 初始化所有 Agent Providers
 */
export function initializeProviders(): void {
  if (initialized) return
  // 注册 Claude Provider
  registerAgentPlugin(claudePlugin)

  console.log('[Providers] Initialized providers:', agentRegistry.getRegisteredTypes())
  initialized = true
}

/**
 * 获取指定类型的 Provider 实例
 */
export function getProvider(type: string): IAgentProvider | null {
  const plugin = agentRegistry.getPlugin(type)
  if (!plugin) {
    return null
  }
  return plugin.factory()
}

/**
 * 获取所有 Provider 的元数据
 */
export function getProvidersMetadata(): Map<string, AgentPlugin['metadata']> {
  return agentRegistry.getAllMetadata()
}

/**
 * 获取所有可用的 Provider（已配置且可用的）
 */
export async function getAvailableProviders(): Promise<string[]> {
  return agentRegistry.getAvailable()
}

/**
 * 创建指定类型的 Agent 实例
 */
export function createAgent(config: AgentProviderConfig) {
  const provider = getProvider(config.provider)
  if (!provider) {
    throw new Error(`Provider not found: ${config.provider}`)
  }
  return provider.createAgent(config)
}

export { createClaudeProvider }
