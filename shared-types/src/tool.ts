/**
 * Tool definition and execution types
 */

import type { JSONSchema7 } from 'json-schema'

/**
 * Definition of a tool that can be used by an agent
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema7
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  success: boolean
  status?: 'success' | 'warning' | 'error'
  output?: string
  error?: string
  exitCode?: number
  summary?: string
  artifacts?: string[]
}

/**
 * A tool call request from the agent
 */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Registry of available tools
 */
export interface ToolRegistry {
  tools: Map<string, ToolDefinition>
  register(tool: ToolDefinition): void
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
}
