/**
 * Sub-Agent - Agent instance for executing subtasks
 *
 * Wraps the base Agent with subtask-specific functionality
 */

import type { IAgent, AgentRunOptions } from '../interface'
import type { SubTask, SubTaskResult, SubTaskStatus } from '@shared-types'
import type { AgentMessage } from '@shared-types'
import { createLogger } from '../../../shared/logger'

const log = createLogger('agent:sub-agent')

export class SubAgent {
  private agent: IAgent
  private id: string
  private model: string
  private status: SubTaskStatus = 'pending'
  private currentSubtask: string | null = null

  constructor(id: string, agent: IAgent, model: string) {
    this.id = id
    this.agent = agent
    this.model = model
  }

  /**
   * Execute a subtask
   */
  async execute(
    subtask: SubTask,
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<SubTaskResult> {
    log.info({ agentId: this.id, subtaskId: subtask.id, description: subtask.description.substring(0, 100) }, 'Starting subtask execution')
    this.status = 'running'
    this.currentSubtask = subtask.id

    const startTime = Date.now()

    try {
      const runOptions: AgentRunOptions = {
        signal: options?.signal,
        systemPrompt: this.createSubtaskPrompt(subtask)
      }

      log.debug({ agentId: this.id }, 'Calling agent.run()')
      // Execute with timeout
      const messages = await this.executeWithTimeout(
        subtask.description,
        runOptions,
        options?.timeout
      )

      log.debug({ agentId: this.id, messageCount: messages.length }, 'Received messages from agent')
      const output = this.extractOutput(messages)
      log.debug({ agentId: this.id, outputLength: output.length }, 'Extracted output')

      this.status = 'success'
      return {
        subtaskId: subtask.id,
        status: 'success',
        output,
        duration: Date.now() - startTime
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log.error({ agentId: this.id, err: errorMessage }, 'Execution error')

      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        this.status = 'timeout'
        return {
          subtaskId: subtask.id,
          status: 'timeout',
          error: 'Execution timeout',
          duration: Date.now() - startTime
        }
      }

      this.status = 'failed'
      return {
        subtaskId: subtask.id,
        status: 'failed',
        error: errorMessage,
        duration: Date.now() - startTime
      }
    } finally {
      this.currentSubtask = null
    }
  }

  /**
   * Abort current execution
   */
  abort(): void {
    this.agent.abort()
    this.status = 'failed'
  }

  /**
   * Get agent info
   */
  getInfo(): { id: string; model: string; status: SubTaskStatus; currentSubtask: string | undefined } {
    return {
      id: this.id,
      model: this.model,
      status: this.status,
      currentSubtask: this.currentSubtask ?? undefined
    }
  }

  /**
   * Create system prompt for subtask
   */
  private createSubtaskPrompt(subtask: SubTask): string {
    let prompt = `You are a sub-agent executing a specific subtask as part of a larger task.

Subtask: ${subtask.description}
Priority: ${subtask.priority}`

    if (subtask.scope.files && subtask.scope.files.length > 0) {
      prompt += `\nTarget files: ${subtask.scope.files.join(', ')}`
    }

    if (subtask.scope.range) {
      prompt += `\nTarget lines: ${subtask.scope.range[0]} to ${subtask.scope.range[1]}`
    }

    if (subtask.scope.type) {
      prompt += `\nTarget type: ${subtask.scope.type}`
    }

    prompt += `\n\nFocus on completing only this subtask. Provide a clear summary of what was done.`

    return prompt
  }

  /**
   * Execute with timeout wrapper
   */
  private async executeWithTimeout(
    prompt: string,
    options: AgentRunOptions,
    timeout?: number
  ): Promise<AgentMessage[]> {
    if (!timeout) {
      return await this.agent.run(prompt, options)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.agent.abort()
        reject(new Error('Execution timeout'))
      }, timeout)

      this.agent.run(prompt, options)
        .then(messages => {
          clearTimeout(timer)
          resolve(messages)
        })
        .catch(error => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  /**
   * Extract output from agent messages
   * Handles multiple message types from different providers
   */
  private extractOutput(messages: AgentMessage[]): string {
    log.debug({ agentId: this.id, messageCount: messages.length, types: messages.map(m => m.type) }, 'Extracting output from messages')

    // Check for error messages first
    const errorMessages = messages.filter(m => m.type === 'error')
    if (errorMessages.length > 0) {
      log.error({ agentId: this.id, errors: errorMessages.map(m => m.errorMessage || m.content) }, 'Error messages found')
    }

    // 1. First try to find a 'result' type message
    const resultMessage = messages.find(m => m.type === 'result')
    if (resultMessage?.content) {
      log.debug({ agentId: this.id, contentLength: resultMessage.content.length }, 'Found result message')
      return resultMessage.content
    }

    // 2. Try to find 'direct_answer' type message (used by some providers)
    const directAnswer = messages.find(m => m.type === 'direct_answer')
    if (directAnswer?.content) {
      log.debug({ agentId: this.id, contentLength: directAnswer.content.length }, 'Found direct_answer message')
      return directAnswer.content
    }

    // 3. Concatenate all text messages
    const textMessages = messages.filter(m => m.type === 'text' && m.content)
    if (textMessages.length > 0) {
      const output = textMessages.map(m => m.content).join('\n')
      log.debug({ agentId: this.id, textCount: textMessages.length, combinedLength: output.length }, 'Found text messages')
      return output
    }

    // 4. Fallback: try to extract content from any message with content
    const messagesWithContent = messages.filter(m => m.content && typeof m.content === 'string')
    if (messagesWithContent.length > 0) {
      const output = messagesWithContent.map(m => m.content).join('\n')
      log.debug({ agentId: this.id, fallbackCount: messagesWithContent.length, combinedLength: output.length }, 'Fallback: found messages with content')
      return output
    }

    log.warn({ agentId: this.id }, 'No output found in messages')
    return ''
  }
}
