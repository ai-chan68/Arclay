/**
 * Shared Provider 模块入口
 * 导出所有 Provider 相关的类型和工具
 */

// 类型定义
export type {
  ProviderState,
  ProviderCapabilities,
  ProviderMetadata,
  IProvider,
  ProviderEventType,
  ProviderEvent,
  ProviderEventListener,
  ProviderInstance,
  ProviderPlugin,
  IProviderRegistry,
  PluginLoadResult,
  PluginDiscoveryOptions,
  AutoLoadOptions,
} from './types';

// 注册表
export { BaseProviderRegistry } from './registry';

// Manager
export { providerManager } from './manager';
export type { ProvidersConfig, ProviderCategoryConfig } from './manager';
