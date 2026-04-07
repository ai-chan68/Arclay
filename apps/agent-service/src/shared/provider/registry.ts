/**
 * Provider 注册表基类实现
 * 参考通用注册表模式
 */

import type {
  IProvider,
  IProviderRegistry,
  ProviderPlugin,
  ProviderInstance,
  ProviderEventListener,
  ProviderEvent,
} from './types';

/**
 * Provider 注册表基类
 * 提供插件注册、实例管理、事件分发等通用功能
 */
export abstract class BaseProviderRegistry<
  TProvider extends IProvider,
  TConfig = Record<string, unknown>
> implements IProviderRegistry<TProvider, TConfig>
{
  /** 已注册的插件映射 */
  protected plugins: Map<string, ProviderPlugin<TProvider, TConfig>> = new Map();

  /** Provider 实例映射 */
  protected instances: Map<string, ProviderInstance<TProvider>> = new Map();

  /** 事件监听器集合 */
  protected listeners: Set<ProviderEventListener> = new Set();

  /**
   * 注册插件
   */
  register(plugin: ProviderPlugin<TProvider, TConfig>): void {
    const type = plugin.metadata.type;

    if (this.plugins.has(type)) {
      console.warn(`[ProviderRegistry] Plugin "${type}" is already registered, overwriting...`);
    }

    this.plugins.set(type, plugin);
    this.emitEvent({
      type: 'registered',
      providerType: type,
      timestamp: Date.now(),
      data: plugin.metadata,
    });

    console.log(`[ProviderRegistry] Registered plugin: ${type}`);
  }

  /**
   * 注销插件
   */
  unregister(type: string): void {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      return;
    }

    // 停止并移除相关实例
    const instance = this.instances.get(type);
    if (instance) {
      instance.provider.stop().catch((err) => {
        console.error(`[ProviderRegistry] Error stopping provider "${type}":`, err);
      });
      this.instances.delete(type);
    }

    // 调用销毁回调
    if (plugin.onDestroy) {
      plugin.onDestroy().catch((err) => {
        console.error(`[ProviderRegistry] Error in onDestroy for "${type}":`, err);
      });
    }

    this.plugins.delete(type);
    this.emitEvent({
      type: 'unregistered',
      providerType: type,
      timestamp: Date.now(),
    });

    console.log(`[ProviderRegistry] Unregistered plugin: ${type}`);
  }

  /**
   * 获取插件
   */
  getPlugin(type: string): ProviderPlugin<TProvider, TConfig> | undefined {
    return this.plugins.get(type);
  }

  /**
   * 获取所有已注册的插件类型
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * 获取或创建 Provider 实例
   * 单例模式：每个类型只创建一个实例
   */
  async getInstance(type: string, config?: TConfig): Promise<TProvider> {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new Error(`Provider plugin "${type}" not found`);
    }

    // 检查是否已有实例
    const existingInstance = this.instances.get(type);
    if (existingInstance) {
      // 如果提供了新配置，更新实例
      if (config && JSON.stringify(config) !== JSON.stringify(existingInstance.config)) {
        await existingInstance.provider.stop();
        this.instances.delete(type);
      } else {
        existingInstance.lastUsedAt = Date.now();
        return existingInstance.provider;
      }
    }

    // 创建新实例
    const provider = plugin.factory(config);

    try {
      this.emitEvent({
        type: 'state_changed',
        providerType: type,
        timestamp: Date.now(),
        data: { state: 'initializing' },
      });

      await provider.init(config as Record<string, unknown>);

      this.instances.set(type, {
        provider,
        config: config as Record<string, unknown>,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      });

      this.emitEvent({
        type: 'initialized',
        providerType: type,
        timestamp: Date.now(),
        data: { config },
      });

      console.log(`[ProviderRegistry] Created instance for: ${type}`);
      return provider;
    } catch (error) {
      this.emitEvent({
        type: 'error',
        providerType: type,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 获取所有可用的 Provider 类型
   */
  async getAvailable(): Promise<string[]> {
    const available: string[] = [];

    for (const [type, plugin] of this.plugins) {
      try {
        const provider = plugin.factory();
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          available.push(type);
        }
      } catch (error) {
        console.warn(`[ProviderRegistry] Error checking availability for "${type}":`, error);
      }
    }

    return available;
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: ProviderEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: ProviderEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 发送事件
   */
  protected emitEvent(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ProviderRegistry] Error in event listener:', error);
      }
    }
  }

  /**
   * 停止所有实例
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [type, instance] of this.instances) {
      stopPromises.push(
        instance.provider
          .stop()
          .then(() => {
            this.emitEvent({
              type: 'stopped',
              providerType: type,
              timestamp: Date.now(),
            });
          })
          .catch((err) => {
            console.error(`[ProviderRegistry] Error stopping "${type}":`, err);
            this.emitEvent({
              type: 'error',
              providerType: type,
              timestamp: Date.now(),
              error: err,
            });
          })
      );
    }

    await Promise.allSettled(stopPromises);
    this.instances.clear();
  }

  /**
   * 获取所有实例
   */
  getInstances(): Map<string, ProviderInstance<TProvider>> {
    return new Map(this.instances);
  }

  /**
   * 获取特定实例
   */
  getInstanceInfo(type: string): ProviderInstance<TProvider> | undefined {
    return this.instances.get(type);
  }

  /**
   * 移除实例（不停止）
   */
  removeInstance(type: string): boolean {
    return this.instances.delete(type);
  }
}
