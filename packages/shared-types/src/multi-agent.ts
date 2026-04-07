/**
 * Multi-agent types for parallel task execution
 *
 * This module defines types for the multi-agent orchestration system
 * where a main agent (Opus) coordinates sub-agents (Sonnet) for parallel execution.
 */

import type { SessionStatus } from './agent'

/**
 * Task complexity levels determined by TaskAnalyzer
 */
export type TaskComplexity = 'simple' | 'moderate' | 'complex'

/**
 * Decomposition strategies for breaking down tasks
 */
export type DecompositionStrategy = 
  | 'file-based'     // Split by files
  | 'range-based'    // Split by line ranges
  | 'type-based'     // Split by entity types
  | 'scene-based'    // Split by application scenes (pages, slides, etc.)
  | 'artifact-based' // Split by output artifact types
  | 'preview-aware'  // Split considering preview capabilities

/**
 * Subtask priority levels
 */
export type SubTaskPriority = 'high' | 'medium' | 'low'

/**
 * Multi-agent execution phases
 */
export type MultiAgentPhase =
  | 'analyzing'    // Analyzing task complexity
  | 'decomposing'  // Breaking down into subtasks
  | 'executing'    // Running subtasks in parallel
  | 'aggregating'  // Combining results
  | 'completed'    // All done

/**
 * Subtask status values
 */
export type SubTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped'

/**
 * Result of task analysis
 */
export interface TaskAnalysis {
  /** Complexity level of the task */
  complexity: TaskComplexity
  /** Whether decomposition is needed */
  requiresDecomposition: boolean
  /** Estimated number of subtasks */
  estimatedSubtasks: number
  /** Recommended level of parallelism (1-5) */
  recommendedParallelism: number
  /** Selected decomposition strategy */
  decompositionStrategy: DecompositionStrategy
}

/**
 * Scope definition for a subtask
 */
export interface SubTaskScope {
  /** Target files for file-based decomposition */
  files?: string[]
  /** Line range for range-based decomposition [start, end] */
  range?: [number, number]
  /** Entity type for type-based decomposition */
  type?: string
  /** Scene for scene-based decomposition */
  scene?: string
  /** Artifact type for artifact-based decomposition */
  artifactType?: string
  /** Artifact name for artifact-based decomposition */
  artifactName?: string
  /** Output format for artifact-based decomposition */
  outputFormat?: string
  /** Whether task is previewable for preview-aware decomposition */
  previewable?: boolean
  /** Task priority for preview-aware decomposition */
  priority?: SubTaskPriority
}

/**
 * Subtask definition
 */
export interface SubTask {
  /** Unique identifier for this subtask */
  id: string
  /** Parent task ID (for tracking) */
  parentTaskId: string
  /** Human-readable description */
  description: string
  /** Scope of work for this subtask */
  scope: SubTaskScope
  /** IDs of subtasks that must complete first */
  dependencies: string[]
  /** Priority level */
  priority: SubTaskPriority
}

/**
 * Result of a subtask execution
 */
export interface SubTaskResult {
  /** ID of the subtask */
  subtaskId: string
  /** Execution status */
  status: SubTaskStatus
  /** Output from successful execution */
  output?: string
  /** Error message if failed */
  error?: string
  /** Execution duration in ms */
  duration?: number
  /** Token usage if available */
  tokenUsage?: {
    input: number
    output: number
    total: number
  }
}

/**
 * Sub-agent information
 */
export interface SubAgentInfo {
  /** Agent ID */
  id: string
  /** Model being used */
  model: string
  /** Current status */
  status: SubTaskStatus
  /** Subtask being executed (if any) */
  currentSubtask?: string
}

/**
 * Progress information for multi-agent execution
 */
export interface MultiAgentProgress {
  /** Total number of subtasks */
  total: number
  /** Number completed */
  completed: number
  /** Number currently running */
  running: number
  /** Number failed */
  failed: number
}

/**
 * Multi-agent execution status
 */
export interface MultiAgentStatus {
  /** Current execution phase */
  phase: MultiAgentPhase
  /** Orchestrator information */
  orchestrator: {
    model: string
    status: 'idle' | 'running' | 'completed' | 'error'
  }
  /** Sub-agents and their status */
  subAgents: SubAgentInfo[]
  /** Progress tracking */
  progress: MultiAgentProgress
  /** Task analysis result */
  analysis?: TaskAnalysis
  /** Subtask breakdown */
  subtasks?: SubTask[]
  /** Execution results */
  results?: SubTaskResult[]
  /** Error if any */
  error?: string
}

/**
 * Multi-agent configuration
 */
export interface MultiAgentConfig {
  /** Maximum concurrent agents (default: 5) */
  maxAgents: number
  /** Main agent model for orchestration */
  mainAgentModel: string
  /** Sub-agent model for parallel execution */
  subAgentModel: string
  /** Decomposition strategy ('auto' or specific strategy) */
  decompositionStrategy: 'auto' | DecompositionStrategy
  /** Timeout per subtask in ms */
  timeout: number
  /** Enable cost tracking */
  trackCosts?: boolean
  /** System prompt for agents */
  systemPrompt?: string
  /** Preferred tools for agents */
  preferredTools?: string[]
  /** Enable preview capabilities */
  enablePreview?: boolean
}

/**
 * Cost breakdown for multi-agent execution
 */
export interface MultiAgentCost {
  /** Estimated cost before execution */
  estimated: number
  /** Actual cost after execution */
  actual: number
  /** Cost by agent type */
  breakdown: {
    orchestrator: number
    subAgents: number
  }
  /** Token usage summary */
  tokens: {
    input: number
    output: number
    total: number
  }
}

/**
 * Extended agent message types for multi-agent
 */
export interface MultiAgentMessage {
  /** Message type */
  type: 'status' | 'subtask' | 'result' | 'error' | 'cost'
  /** Phase update */
  phase?: MultiAgentPhase
  /** Subtask update */
  subtask?: {
    id: string
    status: SubTaskStatus
    progress?: MultiAgentProgress
  }
  /** Final result */
  result?: string
  /** Error message */
  error?: string
  /** Cost information */
  cost?: MultiAgentCost
  /** Timestamp */
  timestamp: number
}

/**
 * Agent role in multi-agent system
 */
export type AgentRole = 'orchestrator' | 'sub-agent'

/**
 * Extended agent session with multi-agent support
 */
export interface MultiAgentSession {
  /** Session ID */
  id: string
  /** Creation timestamp */
  createdAt: number
  /** Agent role */
  role: AgentRole
  /** Parent session ID (for sub-agents) */
  parentSessionId?: string
  /** Model being used */
  model: string
  /** Current status */
  status: SessionStatus
}
