/**
 * Memory System — public API
 *
 * Three-layer memory for EasyWork Agent:
 *   Working memory  = SDK messages[] (managed by SDK)
 *   Procedural memory = Skills files (managed by skills service)
 *   Episodic/Semantic memory = This module
 */

export { MemoryStore, truncateToTokenBudget, estimateTokens } from './memory-store'
export { MemoryInjector } from './memory-injector'
export { HistoryLogger } from './history-logger'
export { generateDailySummary } from './daily-memory'
export { searchMemory, parseQuery } from './memory-retriever'
export { getMemoryToolInstruction } from './memory-tool'
export type {
  MemoryEntry,
  MemoryCategory,
  MemorySource,
  HistoryRecord,
  HistoryRecordType,
  MemoryBudget,
} from './types'
export { DEFAULT_MEMORY_BUDGET } from './types'
