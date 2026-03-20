/**
 * Configuration loading utility
 * 支持新的 Provider 架构
 */

import type { AgentProviderConfig, AgentProviderType } from './core/agent/types';
import type { ProviderConfig, LLMProvider } from '@shared-types';
import * as path from 'path';
import { getSettings, getActiveProviderConfig } from './settings-store';

/**
 * Provider 默认值
 */
const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl?: string }> = {
  claude: {
    model: 'claude-sonnet-4-20250514',
  },
  glm: {
    model: 'glm-4-flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  openai: {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  },
  deepseek: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
  },
  openrouter: {
    model: 'anthropic/claude-sonnet-4',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  kimi: {
    model: 'moonshot-v1-128k',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
};

/**
 * 获取 Agent Provider 配置
 * 严格使用 Settings 文件中的配置，不回退到环境变量
 */
export function getAgentProviderConfig(
  providerType?: AgentProviderType
): AgentProviderConfig {
  // 从 settings 文件获取当前生效的 provider 配置
  const activeProvider = getActiveProviderConfig();

  if (activeProvider && activeProvider.apiKey) {
    const provider = activeProvider.provider as AgentProviderType;
    const defaults = PROVIDER_DEFAULTS[provider];

    if (!defaults) {
      throw new Error(`Unknown LLM provider: ${provider}`);
    }

    const config: AgentProviderConfig = {
      provider,
      apiKey: activeProvider.apiKey,
      model: activeProvider.model || defaults.model,
    };

    // 添加 baseUrl
    const baseUrl = activeProvider.baseUrl || defaults.baseUrl;
    if (baseUrl) {
      config.baseUrl = baseUrl;
    }

    return config;
  }

  // 没有配置时抛出错误
  throw new Error(
    'No active provider configured. Please configure a provider in the settings UI.'
  );
}

/**
 * Get provider configuration
 * 优先级：1. Settings 文件（用户通过UI配置） 2. 环境变量
 */
export function getProviderConfig(): ProviderConfig {
  const agentConfig = getAgentProviderConfig();
  return {
    provider: agentConfig.provider as LLMProvider,
    apiKey: agentConfig.apiKey,
    model: agentConfig.model,
    baseUrl: agentConfig.baseUrl,
  };
}

/**
 * 获取所有可用的 Provider 配置
 * 严格从 settings 文件读取，不使用环境变量
 */
export function getAllProviderConfigs(): Record<string, AgentProviderConfig> {
  const configs: Record<string, AgentProviderConfig> = {};

  // 从 settings 中获取所有 providers
  const settings = getSettings();
  if (settings?.providers) {
    for (const providerItem of settings.providers) {
      if (providerItem.apiKey) {
        try {
          const defaults = PROVIDER_DEFAULTS[providerItem.provider];
          if (!defaults) continue;

          const config: AgentProviderConfig = {
            provider: providerItem.provider as AgentProviderType,
            apiKey: providerItem.apiKey,
            model: providerItem.model || defaults.model,
          };

          const baseUrl = providerItem.baseUrl || defaults.baseUrl;
          if (baseUrl) {
            config.baseUrl = baseUrl;
          }

          configs[providerItem.id] = config;
        } catch {
          // 忽略错误
        }
      }
    }
  }

  return configs;
}

/**
 * Get working directory from environment
 * The workspace is located at src-api/workspace where session files are stored.
 */
export function getWorkDir(): string {
  const cwd = process.cwd();
  // When running from within src-api/ (e.g. pnpm dev:api), avoid doubling the path
  if (cwd.endsWith('/src-api') || cwd.endsWith('\\src-api')) {
    return path.resolve(cwd, 'workspace');
  }
  return path.resolve(cwd, 'src-api/workspace');
}

/**
 * Get project root directory
 * This is the directory where SKILLs/ folder should be located
 */
export function getProjectRoot(): string {
  const cwd = process.cwd();
  // When running from within src-api/, project root is the parent directory
  if (cwd.endsWith('/src-api') || cwd.endsWith('\\src-api')) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

/**
 * Get sandbox timeout from environment
 */
export function getSandboxTimeout(): number {
  const timeout = process.env.SANDBOX_TIMEOUT;
  return timeout ? parseInt(timeout, 10) : 60000;
}

/**
 * Get sandbox provider type from environment
 */
export function getSandboxProvider(): 'native' | 'claude' | 'docker' | 'e2b' {
  const provider = process.env.SANDBOX_PROVIDER;
  const validProviders: Array<'native' | 'claude' | 'docker' | 'e2b'> = ['native', 'claude', 'docker', 'e2b'];
  if (provider && validProviders.includes(provider as 'native' | 'claude' | 'docker' | 'e2b')) {
    return provider as 'native' | 'claude' | 'docker' | 'e2b';
  }
  return 'native';
}

/**
 * Get frontend URL for CORS
 */
export function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'http://localhost:1420';
}

/**
 * Get server port
 */
export function getServerPort(): number {
  const port = process.env.PORT;
  return port ? parseInt(port, 10) : 2026;
}

/**
 * Validate configuration
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const providerConfig = getProviderConfig();

  if (!providerConfig.apiKey) {
    errors.push(`Missing API key for provider: ${providerConfig.provider}`);
  }

  if (!providerConfig.model) {
    errors.push(`Missing model for provider: ${providerConfig.provider}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Log configuration (without secrets)
 */
export function logConfig(): void {
  const providerConfig = getProviderConfig();
  const allConfigs = getAllProviderConfigs();

  console.log('Configuration:');
  console.log(`  Active Provider: ${providerConfig.provider}`);
  console.log(`  Model: ${providerConfig.model}`);
  console.log(`  API Key: ${providerConfig.apiKey ? '***configured***' : '***missing***'}`);
  console.log(`  Work Dir: ${getWorkDir()}`);
  console.log(`  Sandbox Provider: ${getSandboxProvider()}`);
  console.log(`  Sandbox Timeout: ${getSandboxTimeout()}ms`);

  // 显示所有可用的 Provider
  const availableProviders = Object.keys(allConfigs).filter(
    (p) => allConfigs[p].apiKey
  );
  if (availableProviders.length > 1) {
    console.log(`  Available Providers: ${availableProviders.join(', ')}`);
  }
}
