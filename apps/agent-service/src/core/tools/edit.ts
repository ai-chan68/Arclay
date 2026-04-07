/**
 * Edit tool - makes targeted edits to a file
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

function buildErrorContract(root: string, retry: string, stop: string): string {
  return `[root] ${root} | [retry] ${retry} | [stop] ${stop}`
}

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

  async execute(params: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const filePath = params.file_path as string
    const oldString = params.old_string as string
    const newString = params.new_string as string
    const replaceAll = params.replace_all as boolean

    if (!filePath) {
      return {
        success: false,
        status: 'error',
        error: buildErrorContract('file_path is required', 'provide absolute path', 'immediately')
      }
    }

    if (oldString === undefined) {
      return {
        success: false,
        status: 'error',
        error: buildErrorContract('old_string is required', 'provide text to replace', 'immediately')
      }
    }

    if (newString === undefined) {
      return {
        success: false,
        status: 'error',
        error: buildErrorContract('new_string is required', 'provide replacement text', 'immediately')
      }
    }

    try {
      // Check if file exists
      const exists = await this.sandbox.exists(filePath)
      if (!exists) {
        return {
          success: false,
          status: 'error',
          error: buildErrorContract(`file not found: ${filePath}`, 'check path or use glob', 'after verifying existence'),
          next_actions: ['use glob to find files', 'check parent directory']
        }
      }

      // Read current content
      const content = await this.sandbox.readFile(filePath)

      // Check if old_string exists
      if (!content.includes(oldString)) {
        return {
          success: false,
          status: 'error',
          error: buildErrorContract(`old_string not found in file`, 'check exact string or use read to verify content', 'after verifying content'),
          next_actions: ['read file to verify content', 'use a different old_string']
        }
      }

      // Check for multiple occurrences
      const occurrences = content.split(oldString).length - 1
      if (occurrences > 1 && !replaceAll) {
        return {
          success: false,
          status: 'error',
          error: buildErrorContract(`old_string appears ${occurrences} times in the file`, 'use replace_all=true or provide unique context', 'if multiple matches are unintended'),
          next_actions: ['read file to find unique context', 'set replace_all: true']
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
        status: 'success',
        output: `Successfully edited ${filePath} (${replaceAll ? occurrences : 1} replacement${replaceAll && occurrences > 1 ? 's' : ''})`,
        summary: `Edited ${filePath} (${replaceAll ? occurrences : 1} replacement${replaceAll && occurrences > 1 ? 's' : ''})`,
        artifacts: [filePath],
        next_actions: ['run tests', 'commit changes', 'verify modification with read']
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        status: 'error',
        error: buildErrorContract(`failed to edit file: ${message}`, 'check file state or permissions', 'if persistent')
      }
    }
  }
}

/**
 * Create edit tool with sandbox
 */
export function createEditTool(sandbox: SandboxService): ITool {
  return new EditTool(sandbox)
}
