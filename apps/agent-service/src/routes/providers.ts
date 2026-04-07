/**
 * Provider Management API Routes
 * Provider 管理相关的 API 端点
 */

import { Hono } from 'hono';
import { agentRegistry } from '../core/agent/registry';
import { getAvailableProviders, getProvidersMetadata } from '../core/agent/providers';
import { getAgentProviderConfig, getAllProviderConfigs } from '../config';
import { providerManager } from '../shared/provider/manager';
import { getActiveProviderConfig } from '../settings-store';
import type { AgentProviderType } from '../core/agent/types';

const providers = new Hono();

async function ensureProviderManagerReady(): Promise<void> {
  if (!providerManager.getRegistry('agent')) {
    await providerManager.initialize();
  }
}

/**
 * GET /providers
 * 获取所有 Provider 元数据
 */
providers.get('/', async (c) => {
  const metadata = getProvidersMetadata();
  const result = Array.from(metadata.entries()).map(([type, meta]) => ({
    type,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    defaultModel: meta.defaultModel || meta.capabilities?.supportedModels?.[0],
    supportedModels: meta.capabilities?.supportedModels || [],
    capabilities: meta.capabilities,
  }));

  return c.json({
    success: true,
    providers: result,
  });
});

/**
 * GET /providers/available
 * 获取所有可用的 Provider（已配置 API Key）
 */
providers.get('/available', async (c) => {
  try {
    const available = await getAvailableProviders();
    const allConfigs = getAllProviderConfigs();

    const result = available.map((type) => ({
      type,
      config: allConfigs[type] || null,
    }));

    return c.json({
      success: true,
      available: result,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get available providers',
      },
      500
    );
  }
});

/**
 * GET /providers/current
 * 获取当前活跃的 Provider
 */
providers.get('/current', async (c) => {
  try {
    // 优先从 settings 获取当前 active provider
    const activeProvider = getActiveProviderConfig();
    const config = activeProvider
      ? {
          provider: activeProvider.provider,
          model: activeProvider.model,
          apiKey: activeProvider.apiKey,
        }
      : getAgentProviderConfig();
    const metadata = agentRegistry.getMetadata(config.provider as AgentProviderType);

    return c.json({
      success: true,
      current: {
        type: config.provider,
        model: config.model,
        name: metadata?.name || config.provider,
        configured: !!(config.apiKey && config.apiKey !== '***configured***'),
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get current provider',
      },
      500
    );
  }
});

/**
 * GET /providers/:type
 * 获取特定 Provider 的详细信息
 */
providers.get('/:type', async (c) => {
  const type = c.req.param('type') as AgentProviderType;
  const metadata = agentRegistry.getMetadata(type);

  if (!metadata) {
    return c.json(
      {
        success: false,
        error: `Provider not found: ${type}`,
      },
      404
    );
  }

  // 获取配置
  let config = null;
  try {
    config = getAgentProviderConfig(type);
  } catch {
    // 忽略错误
  }

  return c.json({
    success: true,
    provider: {
      type: metadata.type,
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      defaultModel: metadata.defaultModel || metadata.capabilities?.supportedModels?.[0],
      supportedModels: metadata.capabilities?.supportedModels || [],
      capabilities: metadata.capabilities,
      configured: config ? !!config.apiKey : false,
    },
  });
});

/**
 * POST /providers/switch
 * 切换当前 Provider
 */
providers.post('/switch', async (c) => {
  try {
    await ensureProviderManagerReady();
    const body = await c.req.json();
    const { type, model, apiKey, baseUrl } = body;

    if (!type) {
      return c.json(
        {
          success: false,
          error: 'Provider type is required',
        },
        400
      );
    }

    const metadata = agentRegistry.getMetadata(type);
    if (!metadata) {
      return c.json(
        {
          success: false,
          error: `Unknown provider: ${type}`,
        },
        400
      );
    }

    // 构建配置
    const config = {
      provider: type,
      apiKey: apiKey || process.env[`${type.toUpperCase()}_API_KEY`] || '',
      model: model || metadata.defaultModel,
      baseUrl,
    };

    // 验证配置
    if (!config.apiKey) {
      return c.json(
        {
          success: false,
          error: `API key not configured for provider: ${type}`,
        },
        400
      );
    }

    // 切换 provider
    await providerManager.switchAgentProvider(type, config);

    return c.json({
      success: true,
      message: `Switched to ${metadata.name}`,
      config: {
        provider: type,
        model: config.model,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to switch provider',
      },
      500
    );
  }
});

/**
 * POST /providers/validate
 * 验证 Provider 配置
 */
providers.post('/validate', async (c) => {
  try {
    const body = await c.req.json();
    const { type, apiKey, model, baseUrl } = body;

    if (!type || !apiKey || !model) {
      return c.json(
        {
          success: false,
          error: 'Provider type, apiKey, and model are required',
        },
        400
      );
    }

    // 获取 provider 验证配置
    const plugin = agentRegistry.getPlugin(type);
    if (!plugin) {
      return c.json(
        {
          success: false,
          error: `Unknown provider: ${type}`,
        },
        400
      );
    }

    const provider = plugin.factory();
    const config = { provider: type, apiKey, model, baseUrl };
    const isValid = provider.validateConfig(config);

    return c.json({
      success: true,
      valid: isValid,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      },
      500
    );
  }
});

/**
 * GET /providers/:type/models
 * 获取 Provider 支持的模型列表
 */
providers.get('/:type/models', async (c) => {
  const type = c.req.param('type') as AgentProviderType;
  const metadata = agentRegistry.getMetadata(type);

  if (!metadata) {
    return c.json(
      {
        success: false,
        error: `Provider not found: ${type}`,
      },
      404
    );
  }

  return c.json({
    success: true,
    models: metadata.capabilities?.supportedModels || [],
    defaultModel: metadata.defaultModel || metadata.capabilities?.supportedModels?.[0],
  });
});

export { providers as providersRoutes };
