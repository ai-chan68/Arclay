/**
 * Agent interface definitions
 *
 * This module defines the core interfaces for agent implementations
 * that can work with different LLM providers.
 */

import type { AgentMessage, AgentSessionInfo } from '@shared-types'
import type { ProviderConfig, ToolDefinition } from '@shared-types'
import type { TaskPlan } from '../../types/agent-new'

/**
 * Options for agent execution
 */
export interface AgentRunOptions {
  /** System prompt to guide agent behavior */
  systemPrompt?: string
  /** Available tools for the agent */
  tools?: ToolDefinition[]
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Session to continue (if any) */
  sessionId?: string
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Temperature for response generation */
  temperature?: number

  // ========== SDK 扩展配置 ==========

  /** 工作目录 */
  cwd?: string
  /** 任务 ID */
  taskId?: string
  /** 允许的工具列表 */
  allowedTools?: string[]
  /** Skills 配置 */
  skillsConfig?: import('./types').SkillsConfig
  /** MCP 配置 */
  mcpConfig?: import('./types').McpConfig
  /** Sandbox 配置 */
  sandbox?: import('./types').SandboxConfig
  /** 对话历史 */
  conversation?: ConversationMessage[]
  /** 图片附件 */
  images?: import('./types').ImageAttachment[]
  /** AbortController */
  abortController?: AbortController
  /** ContextManager instance for step-level variable tracking */
  contextManager?: unknown
  /** Complexity hint from IntentClassifier for adaptive maxTurns */
  complexityHint?: 'simple' | 'medium' | 'complex'
  /** Task plan for step-aware maxTurns calculation */
  plan?: TaskPlan
  /** 工具执行回调（非 Claude Provider 多轮循环使用） */
  toolExecutor?: (
    name: string,
    input: Record<string, unknown>
  ) => Promise<{ success: boolean; output?: string; error?: string }>
}

/**
 * Interface for agent implementations
 */
export interface IAgent {
  /**
   * Run the agent with a prompt and get all messages
   */
  run(prompt: string, options?: AgentRunOptions): Promise<AgentMessage[]>

  /**
   * Stream agent responses as they are generated
   */
  stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage>

  /**
   * Planning phase - Generate execution plan using LLM
   * easywork-style two-phase execution
   */
  plan?(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage>

  /**
   * Format plan for execution phase
   */
  formatPlanForExecution?(plan: import('@shared-types').TaskPlan, workDir: string): string

  /**
   * Abort current execution
   */
  abort(): void

  /**
   * Get current session info
   */
  getSession(): AgentSessionInfo | null
}

/**
 * Interface for LLM provider implementations
 */
export interface IAgentProvider {
  /**
   * Provider name identifier
   */
  readonly name: string

  /**
   * Create an agent instance with the given configuration
   */
  createAgent(config: ProviderConfig): IAgent

  /**
   * Validate provider configuration
   */
  validateConfig(config: ProviderConfig): boolean

  /**
   * Get default model for this provider
   */
  getDefaultModel(): string
}

/**
 * Message role for conversation history
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Internal message format for conversation history
 */
export interface ConversationMessage {
  role: MessageRole
  content: string
  toolCalls?: ToolCallInternal[]
  toolCallId?: string
}

/**
 * Internal tool call representation
 */
export interface ToolCallInternal {
  id: string
  name: string
  input: Record<string, unknown>
}
