/**
 * Multi-agent orchestrator module
 *
 * @experimental
 * @status NOT_INTEGRATED - Backend implemented, frontend integration pending
 *
 * This module provides multi-agent orchestration capabilities:
 * - TaskAnalyzer: Analyzes task complexity
 * - TaskDecomposer: Decomposes complex tasks into subtasks
 * - MultiAgentOrchestrator: Coordinates parallel subtask execution
 * - ResultAggregator: Combines subtask results
 *
 * See `/api/agent/multi/*` endpoints for API access.
 */

export { MultiAgentOrchestrator } from './multi-agent-orchestrator'
export { TaskAnalyzer } from './task-analyzer'
export { TaskDecomposer } from './task-decomposer'
export { ResultAggregator, type AggregationResult } from './result-aggregator'
