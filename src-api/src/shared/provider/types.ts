/**
 * 通用 Provider 类型定义
 * 参考通用插件化架构设计
 */

/**
 * Provider 状态类型
 */
export type ProviderState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'stopping'
  | 'stopped';

/**
 * Provider 能力定义
 */
export interface ProviderCapabilities {
  /** 是否支持流式响应 */
  supportsStreaming: boolean;
  /** 是否支持工具调用 */
  supportsToolCalling: boolean;
  /** 是否支持多模态 (图片) */
  supportsVision: boolean;
  /** 是否支持系统提示词 */
  supportsSystemPrompt: boolean;
  /** 是否支持会话管理 */
  supportsSession: boolean;
  /** 最大上下文长度 */
  maxContextLength?: number;
  /** 支持的模型列表 */
  supportedModels?: string[];
}

/**
 * Provider 元数据
 */
export interface ProviderMetadata {
  /** Provider 类型标识 */
  type: string;
  /** Provider 显示名称 */
  name: string;
  /** Provider 描述 */
  description?: string;
  /** 版本号 */
  version?: string;
  /** Provider 能力 */
  capabilities?: ProviderCapabilities;
  /** 配置 Schema */
  configSchema?: Record<string, unknown>;
  /** 默认模型 */
  defaultModel?: string;
  /** 默认 baseUrl */
  defaultBaseUrl?: string;
}

/**
 * 基础 Provider 接口
 */
export interface IProvider<TConfig = Record<string, unknown>> {
  /** Provider 类型 */
  readonly type: string;
  /** Provider 名称 */
  readonly name: string;
  /** Provider 状态 */
  readonly state: ProviderState;

  /**
   * 检查 Provider 是否可用
   * 用于验证配置、API Key 等
   */
  isAvailable(): Promise<boolean>;

  /**
   * 初始化 Provider
   */
  init(config?: TConfig): Promise<void>;

  /**
   * 停止 Provider
   */
  stop(): Promise<void>;

  /**
   * 关闭 Provider，释放资源
   */
  shutdown(): Promise<void>;

  /**
   * 获取 Provider 能力
   */
  getCapabilities(): ProviderCapabilities;
}

/**
 * Provider 事件类型
 */
export type ProviderEventType =
  | 'registered'
  | 'unregistered'
  | 'initialized'
  | 'stopped'
  | 'error'
  | 'state_changed';

/**
 * Provider 事件
 */
export interface ProviderEvent {
  type: ProviderEventType;
  providerType: string;
  timestamp: number;
  data?: unknown;
  error?: Error;
}

/**
 * Provider 事件监听器
 */
export type ProviderEventListener = (event: ProviderEvent) => void;

/**
 * Provider 实例信息
 */
export interface ProviderInstance<TProvider extends IProvider = IProvider> {
  provider: TProvider;
  config?: Record<string, unknown>;
  createdAt: number;
  lastUsedAt?: number;
}

/**
 * Provider 插件定义
 */
export interface ProviderPlugin<
  TProvider extends IProvider = IProvider,
  TConfig = Record<string, unknown>
> {
  /** Provider 元数据 */
  metadata: ProviderMetadata;
  /** Provider 工厂函数 */
  factory: (config?: TConfig) => TProvider;
  /** 插件初始化回调 */
  onInit?: () => Promise<void>;
  /** 插件销毁回调 */
  onDestroy?: () => Promise<void>;
}

/**
 * Provider 注册表接口
 */
export interface IProviderRegistry<
  TProvider extends IProvider = IProvider,
  TConfig = Record<string, unknown>
> {
  /** 注册插件 */
  register(plugin: ProviderPlugin<TProvider, TConfig>): void;

  /** 注销插件 */
  unregister(type: string): void;

  /** 获取插件 */
  getPlugin(type: string): ProviderPlugin<TProvider, TConfig> | undefined;

  /** 获取所有已注册的插件类型 */
  getRegisteredTypes(): string[];

  /** 获取或创建 Provider 实例 */
  getInstance(type: string, config?: TConfig): Promise<TProvider>;

  /** 获取所有可用的 Provider 类型 */
  getAvailable(): Promise<string[]>;

  /** 添加事件监听器 */
  addEventListener(listener: ProviderEventListener): void;

  /** 移除事件监听器 */
  removeEventListener(listener: ProviderEventListener): void;

  /** 停止所有实例 */
  stopAll(): Promise<void>;
}

/**
 * 插件加载结果
 */
export interface PluginLoadResult<TProvider extends IProvider = IProvider> {
  success: boolean;
  plugin?: ProviderPlugin<TProvider>;
  error?: Error;
  filePath?: string;
}

/**
 * 插件发现选项
 */
export interface PluginDiscoveryOptions {
  /** 搜索目录 */
  directory: string;
  /** 文件匹配模式 */
  pattern?: string;
  /** 是否递归搜索 */
  recursive?: boolean;
}

/**
 * 插件加载选项
 */
export interface AutoLoadOptions extends PluginDiscoveryOptions {
  /** 目标注册表 */
  registry: IProviderRegistry;
  /** 是否在加载失败时继续 */
  continueOnError?: boolean;
}
