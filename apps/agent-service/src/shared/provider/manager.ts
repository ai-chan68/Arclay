/**
 * Provider Manager
 * 统一管理所有类型的 Provider 注册表
 * 参考统一 ProviderManager 设计
 */

import type { IProvider, IProviderRegistry, ProviderEventListener, ProviderEvent } from './types';

/**
 * Provider 分类配置
 */
export interface ProviderCategoryConfig {
  /** 默认 Provider 类型 */
  defaultProvider?: string;
  /** Provider 配置 */
  providers?: Record<string, unknown>;
}

/**
 * 所有 Provider 的配置
 */
export interface ProvidersConfig {
  /** Agent Provider 配置 */
  agent?: ProviderCategoryConfig;
  /** Sandbox Provider 配置 */
  sandbox?: ProviderCategoryConfig;
}

/**
 * 注册表信息
 */
interface RegistryInfo {
  registry: IProviderRegistry;
  defaultProvider?: string;
}

/**
 * Provider Manager 实现
 * 单例模式
 */
class ProviderManagerImpl {
  /** 注册表映射 */
  private registries: Map<string, RegistryInfo> = new Map();

  /** 当前活跃的 Provider */
  private activeProviders: Map<string, IProvider> = new Map();

  /** 全局配置 */
  private config: ProvidersConfig = {};

  /** 全局事件监听器 */
  private globalListeners: Set<ProviderEventListener> = new Set();
  private initialized = false;

  /**
   * 注册一个 Provider 注册表
   */
  registerRegistry(
    category: string,
    registry: IProviderRegistry,
    defaultProvider?: string
  ): void {
    if (this.registries.has(category)) {
      console.warn(`[ProviderManager] Registry "${category}" already registered, overwriting...`);
    }

    this.registries.set(category, { registry, defaultProvider });

    // 转发注册表事件到全局监听器
    registry.addEventListener((event) => {
      this.emitGlobalEvent({
        ...event,
        data: event.data !== undefined ? { ...event.data as object, category } : { category },
      });
    });

    console.log(`[ProviderManager] Registered registry: ${category}`);
  }

  /**
   * 获取指定分类的注册表
   */
  getRegistry(category: string): IProviderRegistry | undefined {
    return this.registries.get(category)?.registry;
  }

  /**
   * 获取所有已注册的分类
   */
  getCategories(): string[] {
    return Array.from(this.registries.keys());
  }

  /**
   * 设置配置
   */
  setConfig(config: ProvidersConfig): void {
    this.config = config;
  }

  /**
   * 获取配置
   */
  getConfig(): ProvidersConfig {
    return { ...this.config };
  }

  /**
   * 获取指定分类的可用 Providers
   */
  async getAvailableProviders(category: string): Promise<string[]> {
    const registry = this.getRegistry(category);
    if (!registry) {
      console.warn(`[ProviderManager] Registry "${category}" not found`);
      return [];
    }
    return registry.getAvailable();
  }

  /**
   * 获取指定分类的默认 Provider
   */
  getDefaultProvider(category: string): string | undefined {
    const info = this.registries.get(category);
    if (!info) return undefined;

    // 优先使用配置中的默认值
    const configDefault = this.config[category as keyof ProvidersConfig]?.defaultProvider;
    return configDefault || info.defaultProvider;
  }

  /**
   * 获取 Agent Provider
   */
  async getAgentProvider(type?: string, config?: Record<string, unknown>): Promise<IProvider | undefined> {
    const registry = this.getRegistry('agent');
    if (!registry) {
      console.warn('[ProviderManager] Agent registry not found');
      return undefined;
    }

    const providerType = type || this.getDefaultProvider('agent');
    if (!providerType) {
      console.warn('[ProviderManager] No default agent provider configured');
      return undefined;
    }

    try {
      const provider = await registry.getInstance(providerType, config);
      this.activeProviders.set(`agent:${providerType}`, provider);
      return provider;
    } catch (error) {
      console.error(`[ProviderManager] Failed to get agent provider "${providerType}":`, error);
      return undefined;
    }
  }

  /**
   * 切换 Agent Provider
   */
  async switchAgentProvider(
    type: string,
    config?: Record<string, unknown>
  ): Promise<void> {
    const registry = this.getRegistry('agent');
    if (!registry) {
      throw new Error('Agent registry not found');
    }

    // 停止当前活跃的 agent provider
    for (const [key, provider] of this.activeProviders) {
      if (key.startsWith('agent:')) {
        await provider.stop();
        this.activeProviders.delete(key);
      }
    }

    // 获取新的 provider
    const provider = await registry.getInstance(type, config);
    this.activeProviders.set(`agent:${type}`, provider);

    // 更新配置
    this.config.agent = {
      ...this.config.agent,
      defaultProvider: type,
      providers: {
        ...this.config.agent?.providers,
        [type]: config,
      },
    };

    console.log(`[ProviderManager] Switched to agent provider: ${type}`);
  }

  /**
   * 获取当前活跃的 Provider
   */
  getActiveProvider(category: string, type?: string): IProvider | undefined {
    const key = type ? `${category}:${type}` : undefined;
    if (key) {
      return this.activeProviders.get(key);
    }

    // 返回该分类的第一个活跃 provider
    for (const [k, provider] of this.activeProviders) {
      if (k.startsWith(`${category}:`)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * 获取所有活跃的 Providers
   */
  getActiveProviders(): Map<string, IProvider> {
    return new Map(this.activeProviders);
  }

  /**
   * 添加全局事件监听器
   */
  addGlobalEventListener(listener: ProviderEventListener): void {
    this.globalListeners.add(listener);
  }

  /**
   * 移除全局事件监听器
   */
  removeGlobalEventListener(listener: ProviderEventListener): void {
    this.globalListeners.delete(listener);
  }

  /**
   * 发送全局事件
   */
  private emitGlobalEvent(event: ProviderEvent): void {
    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ProviderManager] Error in global event listener:', error);
      }
    }
  }

  /**
   * 初始化 Manager
   * 动态导入并注册所有 registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    console.log('[ProviderManager] Initializing...');

    // 动态导入 Agent Registry
    // 这个会在 agent registry 文件创建后可用
    try {
      const { agentRegistry } = await import('../../core/agent/registry');
      // 使用类型断言来解决泛型不兼容问题
      this.registerRegistry('agent', agentRegistry as unknown as IProviderRegistry, 'claude');
      console.log('[ProviderManager] Agent registry loaded');
    } catch (error) {
      console.warn('[ProviderManager] Failed to load agent registry:', error);
    }

    try {
      const { sandboxRegistry } = await import('../../core/sandbox/registry');
      this.registerRegistry('sandbox', sandboxRegistry as unknown as IProviderRegistry, 'native');
      console.log('[ProviderManager] Sandbox registry loaded');
    } catch (error) {
      console.warn('[ProviderManager] Failed to load sandbox registry:', error);
    }

    this.initialized = true;
    console.log('[ProviderManager] Initialized');
  }

  /**
   * 关闭 Manager
   */
  async shutdown(): Promise<void> {
    console.log('[ProviderManager] Shutting down...');

    // 停止所有活跃的 providers
    const stopPromises: Promise<void>[] = [];
    for (const provider of this.activeProviders.values()) {
      stopPromises.push(
        provider.shutdown().catch((err) => {
          console.error('[ProviderManager] Error shutting down provider:', err);
        })
      );
    }
    await Promise.allSettled(stopPromises);
    this.activeProviders.clear();

    // 停止所有注册表
    for (const { registry } of this.registries.values()) {
      await registry.stopAll();
    }
    this.registries.clear();

    this.globalListeners.clear();
    this.initialized = false;
    console.log('[ProviderManager] Shutdown complete');
  }
}

// 导出单例
export const providerManager = new ProviderManagerImpl();

// 导出类型
export type { ProviderManagerImpl };
