/**
 * Write tool - writes content to a file
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

function buildErrorContract(root: string, retry: string, stop: string): string {
  return `[root] ${root} | [retry] ${retry} | [stop] ${stop}`
}

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

  async execute(params: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const filePath = params.file_path as string
    const content = params.content as string

    if (!filePath) {
      return {
        success: false,
        status: 'error',
        error: buildErrorContract('file_path is required', 'provide absolute path', 'immediately')
      }
    }

    if (content === undefined || content === null) {
      return {
        success: false,
        status: 'error',
        error: buildErrorContract('content is required', 'provide string content', 'immediately')
      }
    }

    try {
      const text = String(content)
      await this.sandbox.writeFile(filePath, text)
      return {
        success: true,
        status: 'success',
        output: `Successfully wrote to ${filePath}`,
        summary: `Wrote ${text.length} characters to ${filePath}`,
        artifacts: [filePath],
        next_actions: ['read file to verify', 'run tests', 'commit changes']
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        status: 'error',
        error: buildErrorContract(`failed to write file: ${message}`, 'check permissions or disk space', 'if persistent')
      }
    }
  }
}

/**
 * Create write tool with sandbox
 */
export function createWriteTool(sandbox: SandboxService): ITool {
  return new WriteTool(sandbox)
}
