/**
 * Tool registry for managing available tools
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'

/**
 * Tool function type
 */
export type ToolExecutor = (
  params: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>

/**
 * Registered tool entry
 */
interface RegisteredTool {
  definition: ToolDefinition
  executor: ToolExecutor
}

/**
 * Tool registry - manages available tools
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map()

  /**
   * Register a tool
   */
  register(tool: ITool): void
  register(definition: ToolDefinition, executor: ToolExecutor): void
  register(definitionOrTool: ToolDefinition | ITool, executor?: ToolExecutor): void {
    if ('definition' in definitionOrTool && 'execute' in definitionOrTool) {
      // ITool interface
      const tool = definitionOrTool as ITool
      this.tools.set(tool.definition.name, {
        definition: tool.definition,
        executor: (params) => tool.execute(params)
      })
    } else if (executor) {
      // Definition + executor
      const definition = definitionOrTool as ToolDefinition
      this.tools.set(definition.name, {
        definition,
        executor
      })
    } else {
      throw new Error('Invalid tool registration')
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  /**
   * Get tool definition by name
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${name}`
      }
    }
    return tool.executor(params, context)
  }

  /**
   * List all registered tools
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Remove a tool
   */
  remove(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear()
  }
}

/**
 * Global tool registry instance
 */
export const globalToolRegistry = new ToolRegistry()
