/**
 * Tools index - exports all tools
 */

import type { ITool } from './interface'
import { ToolRegistry, globalToolRegistry } from './registry'
import { createReadTool } from './read'
import { createWriteTool } from './write'
import { createEditTool } from './edit'
import { createBashTool } from './bash'
import { createGlobTool } from './glob'
import { createGrepTool } from './grep'
import { createAppendTool } from './append'
import type { SandboxService } from '../sandbox/sandbox-service'

// Re-export types
export type { ITool, ToolContext } from './interface'
export { ToolRegistry, globalToolRegistry } from './registry'

/**
 * Create all default tools with sandbox
 */
export function createDefaultTools(sandbox: SandboxService): ITool[] {
  return [
    createReadTool(sandbox),
    createWriteTool(sandbox),
    createEditTool(sandbox),
    createBashTool(sandbox),
    createGlobTool(sandbox),
    createGrepTool(sandbox),
    createAppendTool(sandbox)
  ]
}

/**
 * Register all default tools with a registry
 */
export function registerDefaultTools(
  registry: ToolRegistry,
  sandbox: SandboxService
): void {
  const tools = createDefaultTools(sandbox)
  for (const tool of tools) {
    registry.register(tool)
  }
}

/**
 * Get tool definitions for all default tools
 */
export function getDefaultToolDefinitions(): ReturnType<ToolRegistry['list']> {
  // Create a temporary registry with default tools to get definitions
  const tempRegistry = new ToolRegistry()
  // We need a sandbox for this, so we'll just return the definitions directly
  return [
    {
      name: 'read',
      description: 'Read the contents of a file. Returns the file content as a string.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to read' },
          offset: { type: 'number', description: 'The line number to start reading from' },
          limit: { type: 'number', description: 'The number of lines to read' }
        },
        required: ['file_path']
      }
    },
    {
      name: 'write',
      description: 'Write content to a file. Creates the file and directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to write' },
          content: { type: 'string', description: 'The content to write to the file' }
        },
        required: ['file_path', 'content']
      }
    },
    {
      name: 'edit',
      description: 'Performs exact string replacements in files.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to edit' },
          old_string: { type: 'string', description: 'The text to replace' },
          new_string: { type: 'string', description: 'The text to replace it with' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences' }
        },
        required: ['file_path', 'old_string', 'new_string']
      }
    },
    {
      name: 'bash',
      description: 'Execute a bash shell command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        },
        required: ['command']
      }
    },
    {
      name: 'glob',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The glob pattern to match' },
          path: { type: 'string', description: 'The directory to search in' }
        },
        required: ['pattern']
      }
    },
    {
      name: 'grep',
      description: 'Search for patterns in file contents using regex.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The regex pattern to search for' },
          path: { type: 'string', description: 'The file or directory to search in' },
          glob: { type: 'string', description: 'Glob pattern to filter files' },
          '-i': { type: 'boolean', description: 'Case insensitive search' }
        },
        required: ['pattern']
      }
    },
    {
      name: 'append',
      description: 'Append content to a file. Creates the file if it does not exist. Use this instead of write when generating large outputs across multiple steps.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to append to' },
          content: { type: 'string', description: 'The content to append' }
        },
        required: ['file_path', 'content']
      }
    }
  ]
}
