/**
 * Bash tool - executes shell commands
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

const definition: ToolDefinition = {
  name: 'bash',
  description: `Execute a bash shell command. Use for running shell commands, scripts, or system operations. Commands run in the sandbox environment with a timeout.`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default 60000)'
      }
    },
    required: ['command']
  }
}

/**
 * Bash tool implementation
 */
export class BashTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const command = params.command as string
    const timeout = (params.timeout as number) || 60000

    if (!command) {
      return { success: false, error: 'command is required' }
    }

    try {
      const result = await this.sandbox.execute(command, {
        timeout,
        signal: context?.signal
      })

      const output = result.stdout + (result.stderr ? `\nstderr:\n${result.stderr}` : '')

      if (result.timedOut) {
        return {
          success: false,
          output,
          error: `Command timed out after ${timeout}ms`
        }
      }

      return {
        success: result.exitCode === 0,
        output: output || '(no output)',
        exitCode: result.exitCode
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: `Command failed: ${message}` }
    }
  }
}

/**
 * Create bash tool with sandbox
 */
export function createBashTool(sandbox: SandboxService): ITool {
  return new BashTool(sandbox)
}
