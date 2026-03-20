/**
 * Tool interface definitions
 */

import type { ToolDefinition, ToolResult } from '@shared-types'

/**
 * Interface for tool implementations
 */
export interface ITool {
  /**
   * Tool definition (schema)
   */
  readonly definition: ToolDefinition

  /**
   * Execute the tool with given parameters
   */
  execute(params: Record<string, unknown>): Promise<ToolResult>
}

/**
 * Context provided to tools during execution
 */
export interface ToolContext {
  /**
   * Working directory for file operations
   */
  workDir: string

  /**
   * Session ID for tracking
   */
  sessionId?: string

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal
}
