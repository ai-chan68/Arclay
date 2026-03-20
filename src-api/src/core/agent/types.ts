/**
 * Agent Provider 类型定义
 * 扩展通用 Provider 类型，添加 Agent 特定的接口
 */

import type {
  IProvider,
  ProviderCapabilities,
  ProviderMetadata,
} from '../../shared/provider/types';
import type { RuntimePlugin, RuntimePluginMetadata } from '../runtime/plugin-types';
import type { AgentMessage, AgentSessionInfo } from '@shared-types';
import type { ToolDefinition } from '@shared-types';

/**
 * Agent Provider 类型
 */
export type AgentProviderType = 'claude' | 'glm' | 'openai' | 'deepseek' | 'openrouter' | 'kimi';

/**
 * Agent Provider 配置
 */
export interface AgentProviderConfig {
  /** Provider 类型 */
  provider: AgentProviderType;
  /** API Key */
  apiKey: string;
  /** 自定义 API 端点 */
  baseUrl?: string;
  /** 模型名称 */
  model: string;
  /** 最大 tokens */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 工作目录 */
  workDir?: string;
  /** Provider 特定配置 */
  providerConfig?: Record<string, unknown>;
}

/**
 * Skills 配置
 */
export interface SkillsConfig {
  /** 是否全局启用 Skills */
  enabled: boolean;
  /** 是否从用户目录加载 (~/.claude/skills) */
  userDirEnabled: boolean;
  /** 是否从项目目录加载 */
  appDirEnabled: boolean;
  /** 自定义 skills 目录路径 */
  skillsPath?: string;
}

/**
 * MCP 配置
 */
export interface McpConfig {
  /** 是否全局启用 MCP */
  enabled: boolean;
  /** 是否从用户目录加载 */
  userDirEnabled: boolean;
  /** 是否从应用目录加载 */
  appDirEnabled: boolean;
  /** 自定义 MCP 配置文件路径 */
  mcpConfigPath?: string;
  /** MCP 服务器配置 */
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  /** 服务器类型 */
  type: 'stdio' | 'sse' | 'http';
  /** 命令（stdio 类型） */
  command?: string;
  /** 参数（stdio 类型） */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** URL（sse/http 类型） */
  url?: string;
  /** HTTP 请求头（sse/http 类型） */
  headers?: Record<string, string>;
}

/**
 * Sandbox 配置
 */
export interface SandboxConfig {
  /** 是否启用 */
  enabled: boolean;
  /** Sandbox 提供者 */
  provider?: string;
  /** 容器镜像 */
  image?: string;
  /** API 端点 */
  apiEndpoint?: string;
}

/**
 * 图片附件
 */
export interface ImageAttachment {
  /** Base64 编码的图片数据 */
  data: string;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * Agent 运行选项
 */
export interface AgentRunOptions {
  /** 系统提示词 */
  systemPrompt?: string;
  /** 可用工具列表 */
  tools?: ToolDefinition[];
  /** 中止信号 */
  signal?: AbortSignal;
  /** 会话 ID（用于继续对话） */
  sessionId?: string;
  /** 最大生成 tokens */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;

  // ========== SDK 扩展配置 ==========

  /** 工作目录 */
  cwd?: string;
  /** 任务 ID */
  taskId?: string;
  /** 允许的工具列表 */
  allowedTools?: string[];
  /** Skills 配置 */
  skillsConfig?: SkillsConfig;
  /** MCP 配置 */
  mcpConfig?: McpConfig;
  /** Sandbox 配置 */
  sandbox?: SandboxConfig;
  /** 对话历史 */
  conversation?: ConversationMessage[];
  /** 图片附件 */
  images?: ImageAttachment[];
  /** AbortController */
  abortController?: AbortController;
  /** 工具执行回调（非 Claude Provider 多轮循环使用） */
  toolExecutor?: (
    name: string,
    input: Record<string, unknown>
  ) => Promise<{ success: boolean; output?: string; error?: string }>;
}

/**
 * Agent 能力定义
 */
export interface AgentCapabilities extends ProviderCapabilities {
  /** 是否支持计划模式 */
  supportsPlanning: boolean;
  /** 是否支持并行工具调用 */
  supportsParallelToolCalls: boolean;
  /** 支持的最大工具调用数 */
  maxToolCalls?: number;
  /** 是否支持 Skills */
  supportsSkills?: boolean;
  /** 是否支持 Sandbox */
  supportsSandbox?: boolean;
  /** 是否支持 MCP */
  supportsMcp?: boolean;
}

/**
 * Agent 接口
 */
export interface IAgent {
  /** Agent 类型 */
  readonly type: AgentProviderType;

  /**
   * 执行 Agent 并返回所有消息
   */
  run(prompt: string, options?: AgentRunOptions): Promise<AgentMessage[]>;

  /**
   * 流式执行 Agent
   */
  stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage>;

  /**
   * 中止当前执行
   */
  abort(): void;

  /**
   * 获取当前会话
   */
  getSession(): AgentSessionInfo | null;
}

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 内部对话消息格式
 */
export interface ConversationMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallInternal[];
  toolCallId?: string;
  /** 关联的图片路径 */
  imagePaths?: string[];
}

/**
 * 内部工具调用表示
 */
export interface ToolCallInternal {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Agent Provider 接口
 * 继承通用 IProvider 接口
 */
export interface IAgentProvider extends IProvider {
  /**
   * 创建 Agent 实例
   */
  createAgent(config: AgentProviderConfig): IAgent;

  /**
   * 验证配置
   */
  validateConfig(config: AgentProviderConfig): boolean;

  /**
   * 获取默认模型
   */
  getDefaultModel(): string;

  /**
   * 获取支持的模型列表
   */
  getSupportedModels(): string[];
}

/**
 * Agent Provider 元数据
 */
export interface AgentProviderMetadata extends RuntimePluginMetadata {
  type: AgentProviderType;
  runtime: 'agent';
  capabilities: AgentCapabilities;
  // defaultModel 和 supportedModels 可以在顶层或 capabilities 中定义
}

/**
 * Agent Provider 插件定义
 */
export interface AgentPlugin extends RuntimePlugin<IAgentProvider, AgentProviderConfig> {
  metadata: AgentProviderMetadata;
  factory: (config?: AgentProviderConfig) => IAgentProvider;
}

/**
 * 定义 Agent Provider 插件的辅助函数
 */
export function defineAgentPlugin(plugin: AgentPlugin): AgentPlugin {
  // 默认能力值
  const defaultCapabilities: AgentCapabilities = {
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsVision: false,
    supportsSystemPrompt: true,
    supportsSession: true,
    supportsPlanning: false,
    supportsParallelToolCalls: false,
  };

  // 合并用户提供的 capabilities（用户值覆盖默认值）
  const mergedCapabilities: AgentCapabilities = {
    ...defaultCapabilities,
    ...plugin.metadata.capabilities,
  };

  return {
    ...plugin,
    metadata: {
      ...plugin.metadata,
      runtime: 'agent',
      capabilities: mergedCapabilities,
    },
  };
}
