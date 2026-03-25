/**
 * Memory System Types
 *
 * Three-layer memory architecture:
 *   Working memory  = SDK messages[] (in-flight, managed by SDK)
 *   Procedural memory = Skills files (loaded on demand)
 *   Episodic/Semantic memory = memory.md + daily/*.md + history.jsonl (this module)
 */

// ---------------------------------------------------------------------------
// Memory Entry — persisted to memory.md
// ---------------------------------------------------------------------------

export type MemoryCategory = 'fact' | 'preference' | 'decision' | 'lesson'
export type MemorySource = 'agent' | 'user' | 'system'

export interface MemoryEntry {
  readonly timestamp: string          // ISO 8601
  readonly source: MemorySource
  readonly category: MemoryCategory
  readonly content: string            // Markdown body
  readonly sessionId?: string
}

// ---------------------------------------------------------------------------
// History Record — persisted to sessions/{id}/history.jsonl
// ---------------------------------------------------------------------------

export type HistoryRecordType =
  | 'user_input'
  | 'agent_response'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'plan'
  | 'done'

export interface HistoryRecord {
  readonly timestamp: string          // ISO 8601
  readonly sessionId: string
  readonly type: HistoryRecordType
  readonly content: string
  readonly metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Memory Budget — controls how much memory is injected into system prompt
// ---------------------------------------------------------------------------

export interface MemoryBudget {
  /** Token budget for memory.md content */
  readonly globalMemory: number
  /** Token budget for recent daily memories */
  readonly dailyMemory: number
  /** Token budget for session context (activeFiles + conversationSummary) */
  readonly sessionContext: number
  /** Total budget across all memory sections */
  readonly total: number
}

export const DEFAULT_MEMORY_BUDGET: MemoryBudget = {
  globalMemory: 2000,
  dailyMemory: 1000,
  sessionContext: 1000,
  total: 4000,
} as const
