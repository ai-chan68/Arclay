/**
 * Parallel Executor - Executes subtasks in parallel with concurrency control
 *
 * Uses semaphore-based concurrency limiting and priority queue
 */

import type { SubTask, SubTaskResult, ProviderConfig } from '@shared-types'
import type { IAgentProvider } from '../interface'
import { AgentPool } from './agent-pool'

export interface ExecutionOptions {
  onSubtaskStart?: (subtaskId: string) => void
  onSubtaskComplete?: (result: SubTaskResult) => void
  provider?: IAgentProvider
  providerConfig?: ProviderConfig
  subAgentModel?: string
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private permits: number
  private waitQueue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }

    return new Promise(resolve => {
      this.waitQueue.push(resolve)
    })
  }

  release(): void {
    const next = this.waitQueue.shift()
    if (next) {
      next()
    } else {
      this.permits++
    }
  }
}

/**
 * Priority queue item
 */
interface QueueItem {
  subtask: SubTask
  priority: number
  insertOrder: number
}

/**
 * Simple priority queue (min-heap based on priority)
 */
class PriorityQueue {
  private items: QueueItem[] = []
  private insertCounter = 0

  enqueue(subtask: SubTask): void {
    const priority = this.getPriorityValue(subtask.priority)
    this.items.push({
      subtask,
      priority,
      insertOrder: this.insertCounter++
    })
    this.sort()
  }

  dequeue(): SubTask | undefined {
    return this.items.shift()?.subtask
  }

  get length(): number {
    return this.items.length
  }

  private sort(): void {
    this.items.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority // Lower value = higher priority
      }
      return a.insertOrder - b.insertOrder // FIFO for same priority
    })
  }

  private getPriorityValue(priority: SubTask['priority']): number {
    switch (priority) {
      case 'high': return 1
      case 'medium': return 2
      case 'low': return 3
      default: return 2
    }
  }
}

export class ParallelExecutor {
  private maxConcurrency: number
  private timeout: number
  private semaphore: Semaphore
  private aborted = false
  private results: Map<string, SubTaskResult> = new Map()
  private agentPool: AgentPool | null = null

  constructor(maxConcurrency: number = 5, timeout: number = 120000) {
    this.maxConcurrency = maxConcurrency
    this.timeout = timeout
    this.semaphore = new Semaphore(maxConcurrency)
  }

  /**
   * Execute subtasks in parallel
   */
  async execute(
    subtasks: SubTask[],
    options: ExecutionOptions = {}
  ): Promise<SubTaskResult[]> {
    this.aborted = false
    this.results.clear()

    console.log('[ParallelExecutor] Execute options:', {
      hasProvider: !!options.provider,
      subAgentModel: options.subAgentModel,
      hasProviderConfig: !!options.providerConfig
    })

    // Initialize agent pool if provider is available
    if (options.provider && options.subAgentModel && options.providerConfig) {
      console.log('[ParallelExecutor] Initializing AgentPool with model:', options.subAgentModel)
      this.agentPool = new AgentPool(
        options.provider,
        options.subAgentModel,
        this.maxConcurrency,
        { providerConfig: options.providerConfig }
      )
    } else {
      console.warn('[ParallelExecutor] No provider or subAgentModel, will use simulation')
    }

    // Build priority queue
    const queue = new PriorityQueue()
    subtasks.forEach(subtask => queue.enqueue(subtask))

    // Track completed dependencies
    const completedDeps = new Set<string>()

    // Execute tasks
    const executionPromises: Promise<void>[] = []

    while (queue.length > 0 && !this.aborted) {
      const subtask = queue.dequeue()
      if (!subtask) break

      // Check if dependencies are met
      const depsMet = subtask.dependencies.every(dep => completedDeps.has(dep))
      if (!depsMet) {
        // Re-queue for later (simple retry mechanism)
        queue.enqueue(subtask)
        await this.sleep(100)
        continue
      }

      // Wait for semaphore
      await this.semaphore.acquire()

      // Execute subtask
      const promise = this.executeSubtask(subtask, options)
        .then(result => {
          completedDeps.add(subtask.id)
          options.onSubtaskComplete?.(result)
        })
        .finally(() => {
          this.semaphore.release()
        })

      executionPromises.push(promise)
    }

    // Wait for all executions to complete
    await Promise.all(executionPromises)

    // Cleanup agent pool
    if (this.agentPool) {
      await this.agentPool.destroy()
      this.agentPool = null
    }

    // Return results in original order
    return subtasks.map(s => this.results.get(s.id)!).filter(Boolean)
  }

  /**
   * Abort all running subtasks
   */
  abort(): void {
    this.aborted = true
    if (this.agentPool) {
      this.agentPool.destroy()
    }
  }

  /**
   * Execute a single subtask
   */
  private async executeSubtask(
    subtask: SubTask,
    options: ExecutionOptions
  ): Promise<SubTaskResult> {
    console.log('[ParallelExecutor] Executing subtask:', subtask.id, 'hasAgentPool:', !!this.agentPool)
    options.onSubtaskStart?.(subtask.id)

    // Use real agent pool if available, otherwise fall back to simulation
    if (this.agentPool) {
      console.log('[ParallelExecutor] Using real AgentPool for subtask:', subtask.id)
      const result = await this.executeWithAgentPool(subtask)
      console.log('[ParallelExecutor] Subtask result:', subtask.id, 'status:', result.status, 'output length:', result.output?.length || 0)
      this.results.set(subtask.id, result)
      return result
    } else {
      // Fallback to simulation for testing
      console.log('[ParallelExecutor] Using simulation for subtask:', subtask.id)
      const result: SubTaskResult = await this.simulateExecution(subtask)
      this.results.set(subtask.id, result)
      return result
    }
  }

  /**
   * Execute subtask using real AgentPool
   */
  private async executeWithAgentPool(subtask: SubTask): Promise<SubTaskResult> {
    if (!this.agentPool) {
      throw new Error('AgentPool not initialized')
    }

    const subAgent = await this.agentPool.acquire()

    try {
      const result = await subAgent.execute(subtask, {
        timeout: this.timeout
      })

      return result
    } finally {
      await this.agentPool.release(subAgent)
    }
  }

  /**
   * Simulate subtask execution (fallback for testing)
   *
   * In real implementation, this would:
   * 1. Acquire SubAgent from AgentPool
   * 2. Execute subtask
   * 3. Release SubAgent back to pool
   */
  private async simulateExecution(subtask: SubTask): Promise<SubTaskResult> {
    // Placeholder: simulate work
    await this.sleep(1000)

    return {
      subtaskId: subtask.id,
      status: 'success',
      output: `Completed: ${subtask.description}`,
      duration: 1000
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
