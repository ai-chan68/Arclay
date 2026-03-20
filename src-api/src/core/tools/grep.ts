/**
 * Grep tool - searches file contents
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'grep',
  description: `Search for patterns in file contents using ripgrep. Supports full regex syntax. Returns matching lines with file paths and line numbers.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for'
      },
      path: {
        type: 'string',
        description: 'The file or directory to search in (defaults to current directory)'
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.ts", "**/*.tsx")'
      },
      '-i': {
        type: 'boolean',
        description: 'Case insensitive search'
      },
      '-n': {
        type: 'boolean',
        description: 'Show line numbers (default true)'
      }
    },
    required: ['pattern']
  }
}

/**
 * Grep tool implementation
 */
export class GrepTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const pattern = params.pattern as string
    const searchPath = (params.path as string) || '.'
    const glob = params.glob as string | undefined
    const caseInsensitive = params['-i'] as boolean
    const showLineNumbers = params['-n'] !== false // default true

    if (!pattern) {
      return { success: false, error: 'pattern is required' }
    }

    try {
      const command = this.buildGrepCommand(pattern, searchPath, {
        glob,
        caseInsensitive,
        showLineNumbers
      })

      const result = await this.sandbox.execute(command)

      if (result.exitCode !== 0 && !result.stdout) {
        return { success: true, output: 'No matches found' }
      }

      const output = result.stdout.trim()
      if (!output) {
        return { success: true, output: 'No matches found' }
      }

      const matchCount = output.split('\n').length
      return {
        success: true,
        output: `Found ${matchCount} match${matchCount > 1 ? 'es' : ''}:\n${output}`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Grep search failed: ${message}` }
    }
  }

  /**
   * Build grep command
   */
  private buildGrepCommand(
    pattern: string,
    searchPath: string,
    options: {
      glob?: string
      caseInsensitive?: boolean
      showLineNumbers?: boolean
    }
  ): string {
    const args: string[] = ['grep']

    // Use ripgrep if available, fall back to grep
    args.push('--color=never')

    if (options.showLineNumbers !== false) {
      args.push('-n')
    }

    if (options.caseInsensitive) {
      args.push('-i')
    }

    if (options.glob) {
      args.push('--glob', `'${options.glob}'`)
    }

    // Escape pattern for shell
    const escapedPattern = pattern.replace(/'/g, "'\\''")
    args.push('-E', `'${escapedPattern}'`)

    // Escape path for shell
    const escapedPath = searchPath.replace(/'/g, "'\\''")
    args.push(`'${escapedPath}'`)

    return args.join(' ')
  }
}

/**
 * Create grep tool with sandbox
 */
export function createGrepTool(sandbox: SandboxService): ITool {
  return new GrepTool(sandbox)
}
