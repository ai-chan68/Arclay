/**
 * Bash tool - executes shell commands
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'

function buildErrorContract(root: string, retry: string, stop: string): string {
  return `[root] ${root} | [retry] ${retry} | [stop] ${stop}`
}

function getCommandName(command: string): string {
  return command.trim().split(/\s+/)[0] || 'command'
}

function getFirstErrorLine(stderr?: string): string {
  if (!stderr) return 'command failed'
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) || 'command failed'
}

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
      return { success: false, status: 'error', error: 'command is required' }
    }

    try {
      const result = await this.sandbox.execute(command, {
        timeout,
        signal: context?.signal
      })

      const stderrValue = result.stderr || undefined
      const exitCode = result.exitCode ?? 1

      if (result.timedOut) {
        return {
          success: false,
          status: 'error',
          output: result.stdout || '(no output)',
          error: buildErrorContract(
            `timed out after ${timeout}ms`,
            'reduce scope or increase timeout',
            'after 3 retries'
          ),
          exitCode,
          summary: `Command timed out after ${timeout}ms`,
        }
      }

      if (exitCode !== 0) {
        return {
          success: false,
          status: 'error',
          output: result.stdout || '(no output)',
          error: buildErrorContract(
            `exit code ${exitCode}: ${getFirstErrorLine(stderrValue)}`,
            'check command syntax',
            'if same error repeats'
          ),
          exitCode,
          summary: `Command failed with exit code ${exitCode}`,
        }
      }

      if (stderrValue) {
        return {
          success: true,
          status: 'warning',
          output: result.stdout || '(no output)',
          error: stderrValue,
          exitCode,
          summary: `Command completed with warnings (exit code ${exitCode})`,
        }
      }

      const commonNextActions = ['check output', 'run next command', 'verify results']

      return {
        success: true,
        status: 'success',
        output: result.stdout || '(no output)',
        error: undefined,
        exitCode,
        summary: `Command succeeded with exit code ${exitCode}`,
        next_actions: commonNextActions
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (/ENOENT/i.test(message)) {
        const commandName = getCommandName(command)
        return {
          success: false,
          status: 'error',
          error: buildErrorContract(
            `command not found: ${commandName}`,
            'install via brew/apt',
            'immediately'
          ),
          summary: `Command failed: ${commandName} is not installed`,
        }
      }

      return {
        success: false,
        status: 'error',
        error: buildErrorContract(
          message,
          'inspect command and environment',
          'if same error repeats'
        ),
        summary: 'Command execution failed',
      }
    }
  }
}

/**
 * Create bash tool with sandbox
 */
export function createBashTool(sandbox: SandboxService): ITool {
  return new BashTool(sandbox)
}
