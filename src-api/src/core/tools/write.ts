/**
 * Write tool - writes content to a file
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'write',
  description: 'Write content to a file. Creates the file if it does not exist, overwrites it if it does. Will create directories if they do not exist.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write'
      },
      content: {
        type: 'string',
        description: 'The content to write to the file'
      }
    },
    required: ['file_path', 'content']
  }
}

/**
 * Write tool implementation
 */
export class WriteTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.file_path as string
    const content = params.content as string

    if (!filePath) {
      return { success: false, error: 'file_path is required' }
    }

    if (content === undefined || content === null) {
      return { success: false, error: 'content is required' }
    }

    try {
      await this.sandbox.writeFile(filePath, String(content))
      return { success: true, output: `Successfully wrote to ${filePath}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Failed to write file: ${message}` }
    }
  }
}

/**
 * Create write tool with sandbox
 */
export function createWriteTool(sandbox: SandboxService): ITool {
  return new WriteTool(sandbox)
}
