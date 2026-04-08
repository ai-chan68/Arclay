/**
 * TodoWrite tool - Track task progress with todo items
 */

import type { ToolDefinition, ToolResult } from '@shared-types'
import type { ITool, ToolContext } from './interface'
import { SandboxService } from '../sandbox/sandbox-service'
import { join } from 'path'

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  reason?: string
}

const definition: ToolDefinition = {
  name: 'TodoWrite',
  description: 'Update task progress by writing todo items. Use this to track which steps are pending, in progress, completed, or failed.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Array of todo items with their current status',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for the todo item (e.g., "1", "2", "step-1")'
            },
            content: {
              type: 'string',
              description: 'Description of the todo item'
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'failed'],
              description: 'Current status of the todo item'
            },
            reason: {
              type: 'string',
              description: 'Optional reason for failed status'
            }
          },
          required: ['id', 'content', 'status']
        }
      }
    },
    required: ['todos']
  }
}

export class TodoWriteTool implements ITool {
  readonly definition = definition
  private sandbox: SandboxService

  constructor(sandbox: SandboxService) {
    this.sandbox = sandbox
  }

  async execute(params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const todos = params.todos as TodoItem[]

    if (!Array.isArray(todos) || todos.length === 0) {
      return {
        success: false,
        status: 'error',
        error: 'todos must be a non-empty array'
      }
    }

    // Validate todo items
    for (const todo of todos) {
      if (!todo.id || !todo.content || !todo.status) {
        return {
          success: false,
          status: 'error',
          error: 'Each todo must have id, content, and status'
        }
      }
      if (!['pending', 'in_progress', 'completed', 'failed'].includes(todo.status)) {
        return {
          success: false,
          status: 'error',
          error: `Invalid status: ${todo.status}`
        }
      }
    }

    try {
      const workDir = context?.workDir || process.cwd()
      const todosPath = join(workDir, '.arclay', 'todos.json')
      const todosData = {
        todos,
        updatedAt: new Date().toISOString()
      }

      await this.sandbox.writeFile(todosPath, JSON.stringify(todosData, null, 2))

      // Calculate progress
      const completed = todos.filter(t => t.status === 'completed').length
      const failed = todos.filter(t => t.status === 'failed').length
      const inProgress = todos.filter(t => t.status === 'in_progress').length
      const pending = todos.filter(t => t.status === 'pending').length

      return {
        success: true,
        status: 'success',
        output: `Progress updated: ${completed}/${todos.length} completed, ${inProgress} in progress, ${pending} pending, ${failed} failed`,
        summary: `Updated ${todos.length} todo items`,
        next_actions: ['continue with next step', 'verify completion']
      }
    } catch (error) {
      return {
        success: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

export function createTodoWriteTool(sandbox: SandboxService): ITool {
  return new TodoWriteTool(sandbox)
}
