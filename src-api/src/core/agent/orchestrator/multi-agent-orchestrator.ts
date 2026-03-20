/**
 * Multi-Agent Orchestrator - Coordinates multi-agent execution
 *
 * Main entry point for multi-agent task execution. Coordinates:
 * - Task analysis (complexity detection)
 * - Task decomposition (subtask generation)
 * - Parallel execution (via ParallelExecutor)
 * - Result aggregation
 */

import type {
  MultiAgentConfig,
  MultiAgentStatus,
  MultiAgentMessage,
  TaskAnalysis,
  SubTask,
  SubTaskResult,
  MultiAgentPhase,
  MultiAgentCost,
  ProviderConfig
} from '@shared-types'
import type { IAgentProvider } from '../interface'
import { TaskAnalyzer, type ScenarioAnalysis as IScenarioAnalysis } from './task-analyzer'
import { TaskDecomposer } from './task-decomposer'
import { ResultAggregator, AggregationResult } from './result-aggregator'
import { ParallelExecutor } from '../pool/parallel-executor'
import { randomUUID } from 'crypto'

export interface MultiAgentOrchestratorOptions {
  provider?: IAgentProvider
  providerConfig?: ProviderConfig
}

export class MultiAgentOrchestrator {
  private analyzer: TaskAnalyzer
  private decomposer: TaskDecomposer
  private aggregator: ResultAggregator
  private executor: ParallelExecutor | null = null
  private abortController: AbortController | null = null
  private status: MultiAgentStatus
  private config: MultiAgentConfig
  private provider?: IAgentProvider
  private providerConfig?: ProviderConfig

  constructor(
    config: Partial<MultiAgentConfig> = {},
    options: MultiAgentOrchestratorOptions = {}
  ) {
    // Use provider's model as default for subAgentModel if not specified
    const defaultSubAgentModel = options.providerConfig?.model || 'claude-sonnet-4'

    this.config = {
      maxAgents: config.maxAgents ?? 5,
      mainAgentModel: config.mainAgentModel ?? 'claude-opus-4-5',
      subAgentModel: config.subAgentModel ?? defaultSubAgentModel,
      decompositionStrategy: config.decompositionStrategy ?? 'auto',
      timeout: config.timeout ?? 120000, // 2 minutes default
      trackCosts: config.trackCosts ?? true
    }

    console.log('[MultiAgentOrchestrator] Config:', {
      subAgentModel: this.config.subAgentModel,
      provider: options.provider?.name,
      providerConfigModel: options.providerConfig?.model
    })

    this.provider = options.provider
    this.providerConfig = options.providerConfig

    this.analyzer = new TaskAnalyzer()
    this.decomposer = new TaskDecomposer()
    this.aggregator = new ResultAggregator()

    this.status = this.createInitialState()
  }

  /**
   * Execute a task with multi-agent orchestration
   * Returns async iterable for streaming status updates
   */
  async *execute(
    prompt: string,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<MultiAgentMessage> {
    const parentTaskId = randomUUID()
    this.abortController = new AbortController()

    // Merge external signal with internal abort controller
    if (options?.signal) {
      options.signal.addEventListener('abort', () => this.abort())
    }

    try {
      // Phase 1: Analyze
      yield* this.analyzePhase(prompt)

      if (!this.status.analysis?.requiresDecomposition) {
        // Simple task - no decomposition needed
        yield* this.executeSimple(prompt, parentTaskId)
        return
      }

      // Phase 2: Decompose
      const subtasks = yield* this.decomposePhase(parentTaskId, prompt)

      // Phase 3: Execute
      const results = yield* this.executePhase(subtasks)

      // Phase 4: Aggregate
      yield* this.aggregatePhase(results as unknown as SubTaskResult[])

    } catch (error) {
      yield this.createErrorMessage(
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Abort current execution
   */
  abort(): void {
    this.abortController?.abort()
    this.executor?.abort()
    this.updatePhase('completed')
  }

  /**
   * Get current status
   */
  getStatus(): MultiAgentStatus {
    return { ...this.status }
  }

  /**
   * Analyze task complexity and scenario
   */
  private async *analyzePhase(prompt: string): AsyncIterable<MultiAgentMessage> {
    this.updatePhase('analyzing')

    yield this.createStatusMessage('analyzing')

    // Perform task analysis
    const analysis = this.analyzer.analyze(prompt)
    this.status.analysis = analysis

    // TODO: Temporarily disabled scenario analysis due to TypeScript issues
    // const scenarioAnalysis = this.analyzer.analyzeScenario(prompt)
    // (this.status as any).scenarioAnalysis = scenarioAnalysis
    // this.adjustConfigForScenario(scenarioAnalysis)

    yield this.createStatusMessage('analyzing')
  }

  /**
   * Decompose task into subtasks
   */
  private async *decomposePhase(
    parentTaskId: string,
    prompt: string
  ): AsyncGenerator<MultiAgentMessage, SubTask[], unknown> {
    this.updatePhase('decomposing')

    yield this.createStatusMessage('decomposing')

    if (!this.status.analysis) {
      throw new Error('No analysis available for decomposition')
    }

    const subtasks = this.decomposer.decompose(
      parentTaskId,
      prompt,
      this.status.analysis
    )

    this.status.subtasks = subtasks
    this.status.progress.total = subtasks.length

    yield this.createStatusMessage('decomposing')

    return subtasks
  }

  /**
   * Execute subtasks in parallel
   */
  private async *executePhase(
    subtasks: SubTask[]
  ): AsyncGenerator<MultiAgentMessage, SubTaskResult[], unknown> {
    this.updatePhase('executing')

    yield this.createStatusMessage('executing')

    this.executor = new ParallelExecutor(
      this.config.maxAgents,
      this.config.timeout
    )

    // Execute with progress callbacks
    const results = await this.executor.execute(subtasks, {
      provider: this.provider,
      providerConfig: this.providerConfig,
      subAgentModel: this.config.subAgentModel,
      onSubtaskStart: (subtaskId: string) => {
        this.status.progress.running++
        this.updateSubAgentStatus(subtaskId, 'running')
      },
      onSubtaskComplete: (result: SubTaskResult) => {
        this.status.progress.running--
        this.status.progress.completed++
        if (result.status === 'failed' || result.status === 'timeout') {
          this.status.progress.failed++
        }
        this.updateSubAgentStatus(result.subtaskId, result.status)
      }
    })

    this.status.results = results

    yield this.createStatusMessage('executing')

    return results
  }

  /**
   * Aggregate results into final output
   */
  private async *aggregatePhase(
    results: SubTaskResult[]
  ): AsyncIterable<MultiAgentMessage> {
    this.updatePhase('aggregating')

    yield this.createStatusMessage('aggregating')

    const aggregation = this.aggregator.aggregate(results)

    this.updatePhase('completed')

    yield this.createResultMessage(aggregation)
  }

  /**
   * Execute simple task (no decomposition)
   */
  private async *executeSimple(
    prompt: string,
    parentTaskId: string
  ): AsyncIterable<MultiAgentMessage> {
    // For simple tasks, just create a single subtask and execute
    const subtask: SubTask = {
      id: randomUUID(),
      parentTaskId,
      description: prompt,
      scope: {},
      dependencies: [],
      priority: 'high'
    }

    this.status.subtasks = [subtask]
    this.status.progress.total = 1

    const results = yield* this.executePhase([subtask])
    yield* this.aggregatePhase(results as unknown as SubTaskResult[])
  }

  /**
   * Update execution phase
   */
  private updatePhase(phase: MultiAgentPhase): void {
    this.status.phase = phase
    this.status.orchestrator.status =
      phase === 'completed' ? 'completed' :
      phase === 'analyzing' || phase === 'executing' ? 'running' : 'idle'
  }

  /**
   * Update sub-agent status
   */
  private updateSubAgentStatus(subtaskId: string, status: SubTaskResult['status']): void {
    const agent = this.status.subAgents.find(a => a.currentSubtask === subtaskId)
    if (agent) {
      agent.status = status
    }
  }

  /**
   * Create initial state
   */
  private createInitialState(): MultiAgentStatus {
    return {
      phase: 'analyzing',
      orchestrator: {
        model: this.config.mainAgentModel,
        status: 'idle'
      },
      subAgents: [],
      progress: {
        total: 0,
        completed: 0,
        running: 0,
        failed: 0
      }
    }
  }

  /**
   * Create status message
   */
  private createStatusMessage(phase: MultiAgentPhase): MultiAgentMessage {
    return {
      type: 'status',
      phase,
      subtask: {
        id: 'orchestrator',
        status: phase === 'completed' ? 'success' : 'running',
        progress: this.status.progress
      },
      timestamp: Date.now()
    }
  }

  /**
   * Create result message
   */
  private createResultMessage(aggregation: AggregationResult): MultiAgentMessage {
    return {
      type: 'result',
      result: [aggregation.summary, ...aggregation.details].join('\n'),
      cost: aggregation.cost,
      timestamp: Date.now()
    }
  }

  /**
   * Create error message
   */
  private createErrorMessage(error: string): MultiAgentMessage {
    return {
      type: 'error',
      error,
      timestamp: Date.now()
    }
  }

  /**
   * Adjust configuration based on detected scenario
   */
  private adjustConfigForScenario(scenarioAnalysis: IScenarioAnalysis): void {
    // TODO: Implement scenario-based configuration adjustment
    console.log('[MultiAgentOrchestrator] Scenario analysis integration temporarily disabled')
  }
}
