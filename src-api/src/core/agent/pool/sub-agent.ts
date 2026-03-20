/**
 * Sub-Agent - Agent instance for executing subtasks
 *
 * Wraps the base Agent with subtask-specific functionality
 */

import type { IAgent, AgentRunOptions } from '../interface'
import type { SubTask, SubTaskResult, SubTaskStatus } from '@shared-types'
import type { AgentMessage } from '@shared-types'

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
    console.log(`[SubAgent ${this.id}] Starting execution for subtask:`, subtask.id)
    console.log(`[SubAgent ${this.id}] Subtask description:`, subtask.description.substring(0, 100))
    this.status = 'running'
    this.currentSubtask = subtask.id

    const startTime = Date.now()

    try {
      const runOptions: AgentRunOptions = {
        signal: options?.signal,
        systemPrompt: this.createSubtaskPrompt(subtask)
      }

      console.log(`[SubAgent ${this.id}] Calling agent.run()...`)
      // Execute with timeout
      const messages = await this.executeWithTimeout(
        subtask.description,
        runOptions,
        options?.timeout
      )

      console.log(`[SubAgent ${this.id}] Received ${messages.length} messages from agent`)
      const output = this.extractOutput(messages)
      console.log(`[SubAgent ${this.id}] Extracted output length:`, output.length)

      this.status = 'success'
      return {
        subtaskId: subtask.id,
        status: 'success',
        output,
        duration: Date.now() - startTime
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SubAgent ${this.id}] Execution error:`, errorMessage)

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
    console.log(`[SubAgent ${this.id}] Extracting output from ${messages.length} messages`)
    console.log(`[SubAgent ${this.id}] Message types:`, messages.map(m => m.type).join(', '))

    // Check for error messages first
    const errorMessages = messages.filter(m => m.type === 'error')
    if (errorMessages.length > 0) {
      console.error(`[SubAgent ${this.id}] Error messages found:`, errorMessages.map(m => m.errorMessage || m.content))
    }

    // 1. First try to find a 'result' type message
    const resultMessage = messages.find(m => m.type === 'result')
    if (resultMessage?.content) {
      console.log(`[SubAgent ${this.id}] Found result message with content length: ${resultMessage.content.length}`)
      return resultMessage.content
    }

    // 2. Try to find 'direct_answer' type message (used by some providers)
    const directAnswer = messages.find(m => m.type === 'direct_answer')
    if (directAnswer?.content) {
      console.log(`[SubAgent ${this.id}] Found direct_answer message with content length: ${directAnswer.content.length}`)
      return directAnswer.content
    }

    // 3. Concatenate all text messages
    const textMessages = messages.filter(m => m.type === 'text' && m.content)
    if (textMessages.length > 0) {
      const output = textMessages.map(m => m.content).join('\n')
      console.log(`[SubAgent ${this.id}] Found ${textMessages.length} text messages, combined length: ${output.length}`)
      return output
    }

    // 4. Fallback: try to extract content from any message with content
    const messagesWithContent = messages.filter(m => m.content && typeof m.content === 'string')
    if (messagesWithContent.length > 0) {
      const output = messagesWithContent.map(m => m.content).join('\n')
      console.log(`[SubAgent ${this.id}] Fallback: found ${messagesWithContent.length} messages with content, combined length: ${output.length}`)
      return output
    }

    console.warn(`[SubAgent ${this.id}] No output found in messages`)
    return ''
  }
}
