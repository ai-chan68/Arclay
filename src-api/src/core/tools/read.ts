/**
 * Read tool - reads file contents
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'read',
  description: 'Read the contents of a file. Returns the file content as a string.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read'
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed). Only provide if the file is too large to read at once.'
      },
      limit: {
        type: 'number',
        description: 'The number of lines to read. Only provide if the file is too large to read at once.'
      }
    },
    required: ['file_path']
  }
}

/**
 * Read tool implementation
 */
export class ReadTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.file_path as string
    const offset = params.offset as number | undefined
    const limit = params.limit as number | undefined

    if (!filePath) {
      return { success: false, error: 'file_path is required' }
    }

    try {
      // Check if file exists
      const exists = await this.sandbox.exists(filePath)
      if (!exists) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      // Read file content
      let content = await this.sandbox.readFile(filePath)

      // Handle offset and limit
      if (offset || limit) {
        const lines = content.split('\n')
        const startLine = offset ? Math.max(1, offset) - 1 : 0
        const endLine = limit ? startLine + limit : lines.length
        content = lines.slice(startLine, endLine).join('\n')
      }

      return { success: true, output: content }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Failed to read file: ${message}` }
    }
  }
}

/**
 * Create read tool with sandbox
 */
export function createReadTool(sandbox: SandboxService): ITool {
  return new ReadTool(sandbox)
}
