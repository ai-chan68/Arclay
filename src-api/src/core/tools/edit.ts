/**
 * Edit tool - makes targeted edits to a file
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'edit',
  description: `Performs exact string replacements in files. Use this to edit files by replacing specific text. The old_string MUST match exactly, including whitespace. Will fail if old_string appears multiple times.`,
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to edit'
      },
      old_string: {
        type: 'string',
        description: 'The text to replace - must match exactly'
      },
      new_string: {
        type: 'string',
        description: 'The text to replace it with'
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences of old_string (default false)'
      }
    },
    required: ['file_path', 'old_string', 'new_string']
  }
}

/**
 * Edit tool implementation
 */
export class EditTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.file_path as string
    const oldString = params.old_string as string
    const newString = params.new_string as string
    const replaceAll = params.replace_all as boolean

    if (!filePath) {
      return { success: false, error: 'file_path is required' }
    }

    if (oldString === undefined) {
      return { success: false, error: 'old_string is required' }
    }

    if (newString === undefined) {
      return { success: false, error: 'new_string is required' }
    }

    try {
      // Check if file exists
      const exists = await this.sandbox.exists(filePath)
      if (!exists) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      // Read current content
      const content = await this.sandbox.readFile(filePath)

      // Check if old_string exists
      if (!content.includes(oldString)) {
        return {
          success: false,
          error: `old_string not found in file. Make sure it matches exactly, including whitespace.`
        }
      }

      // Check for multiple occurrences
      const occurrences = content.split(oldString).length - 1
      if (occurrences > 1 && !replaceAll) {
        return {
          success: false,
          error: `old_string appears ${occurrences} times in the file. Use replace_all=true to replace all occurrences, or provide a more specific old_string.`
        }
      }

      // Perform replacement
      let newContent: string
      if (replaceAll) {
        newContent = content.split(oldString).join(newString)
      } else {
        newContent = content.replace(oldString, newString)
      }

      // Write updated content
      await this.sandbox.writeFile(filePath, newContent)

      return {
        success: true,
        output: `Successfully edited ${filePath} (${replaceAll ? occurrences : 1} replacement${replaceAll && occurrences > 1 ? 's' : ''})`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Failed to edit file: ${message}` }
    }
  }
}

/**
 * Create edit tool with sandbox
 */
export function createEditTool(sandbox: SandboxService): ITool {
  return new EditTool(sandbox)
}
