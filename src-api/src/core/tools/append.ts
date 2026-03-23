/**
 * Append tool - appends content to a file without overwriting
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'append',
  description:
    'Append content to a file. Creates the file if it does not exist. Use this instead of write when generating large outputs across multiple steps (e.g. translating N items, processing N files) to avoid single-call size limits.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to append to'
      },
      content: {
        type: 'string',
        description: 'The content to append'
      }
    },
    required: ['file_path', 'content']
  }
}

export class AppendTool implements ITool {
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
      await this.sandbox.appendFile(filePath, String(content))
      return { success: true, output: `Successfully appended to ${filePath}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Failed to append to file: ${message}` }
    }
  }
}

export function createAppendTool(sandbox: SandboxService): ITool {
  return new AppendTool(sandbox)
}
