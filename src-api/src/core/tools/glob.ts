/**
 * Glob tool - finds files matching a pattern
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'glob',
  description: `Find files matching a glob pattern. Supports **, *, ? wildcards. Returns matching file paths sorted by modification time.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match (e.g., "**/*.ts", "src/**/*.tsx")'
      },
      path: {
        type: 'string',
        description: 'The directory to search in (defaults to current directory)'
      }
    },
    required: ['pattern']
  }
}

/**
 * Glob tool implementation
 */
export class GlobTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const pattern = params.pattern as string
    const searchPath = (params.path as string) || '.'

    if (!pattern) {
      return { success: false, error: 'pattern is required' }
    }

    try {
      // Use find command to implement glob
      const command = this.buildFindCommand(pattern, searchPath)
      const result = await this.sandbox.execute(command)

      if (result.exitCode !== 0 && !result.stdout) {
        return { success: false, error: result.stderr || 'Glob search failed' }
      }

      const files = result.stdout
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0)
        .sort()

      if (files.length === 0) {
        return { success: true, output: 'No files found matching the pattern' }
      }

      return {
        success: true,
        output: `Found ${files.length} file${files.length > 1 ? 's' : ''}:\n${files.join('\n')}`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Glob search failed: ${message}` }
    }
  }

  /**
   * Build find command from glob pattern
   */
  private buildFindCommand(pattern: string, searchPath: string): string {
    // Convert glob pattern to find pattern
    // Simple implementation for common patterns
    const escapedPath = searchPath.replace(/'/g, "'\\''")

    if (pattern.startsWith('**/')) {
      // **/*.ts -> find . -name "*.ts"
      const namePattern = pattern.slice(3)
      return `find '${escapedPath}' -type f -name '${namePattern}' 2>/dev/null`
    }

    if (pattern.includes('**')) {
      // src/**/*.ts -> find src -name "*.ts"
      const parts = pattern.split('**')
      const basePath = parts[0].replace(/\/$/, '')
      const namePattern = parts[1].replace(/^\//, '')
      return `find '${escapedPath}/${basePath}' -type f -name '${namePattern}' 2>/dev/null`
    }

    if (pattern.includes('*')) {
      // *.ts -> find . -maxdepth 1 -name "*.ts"
      return `find '${escapedPath}' -type f -name '${pattern}' 2>/dev/null`
    }

    // No wildcards - just check if file exists
    return `find '${escapedPath}' -type f -name '${pattern}' 2>/dev/null`
  }
}

/**
 * Create glob tool with sandbox
 */
export function createGlobTool(sandbox: SandboxService): ITool {
  return new GlobTool(sandbox)
}
