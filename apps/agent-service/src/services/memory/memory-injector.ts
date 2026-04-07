/**
 * MemoryInjector — assembles memory content into system prompt
 *
 * Priority-based budget allocation:
 *   P1: Global semantic memory (memory.md)     — 2000 tokens
 *   P2: Recent daily memories (last 2 days)    — 1000 tokens
 *   P3: Session context (activeFiles + summary) — 1000 tokens
 *
 * Empty sections are omitted. Total budget: 4000 tokens.
 */

import type { SessionContext } from '../context-manager'
import type { MemoryBudget } from './types'
import { DEFAULT_MEMORY_BUDGET } from './types'
import { MemoryStore, truncateToTokenBudget, estimateTokens } from './memory-store'

export class MemoryInjector {
  constructor(
    private readonly store: MemoryStore,
    private readonly budget: MemoryBudget = DEFAULT_MEMORY_BUDGET
  ) {}

  /**
   * Build the memory prompt to inject into system prompt.
   * Returns empty string if no memory content is available.
   */
  async buildMemoryPrompt(sessionContext?: SessionContext | null): Promise<string> {
    const sections: string[] = []
    let remainingBudget = this.budget.total

    // P1: Global semantic memory
    const globalMemory = await this.store.loadGlobalMemory()
    if (globalMemory.trim()) {
      const sectionBudget = Math.min(this.budget.globalMemory, remainingBudget)
      const truncated = truncateToTokenBudget(globalMemory.trim(), sectionBudget)
      if (truncated) {
        sections.push(`## Long-Term Memory\n${truncated}`)
        remainingBudget -= estimateTokens(truncated)
      }
    }

    // P2: Recent daily memories
    if (remainingBudget > 0) {
      const dailyMemory = await this.store.loadRecentDailyMemories(2)
      if (dailyMemory.trim()) {
        const sectionBudget = Math.min(this.budget.dailyMemory, remainingBudget)
        const truncated = truncateToTokenBudget(dailyMemory.trim(), sectionBudget)
        if (truncated) {
          sections.push(`## Recent Context\n${truncated}`)
          remainingBudget -= estimateTokens(truncated)
        }
      }
    }

    // P3: Session context
    if (remainingBudget > 0 && sessionContext) {
      const contextParts = this.buildSessionContextSection(sessionContext)
      if (contextParts) {
        const sectionBudget = Math.min(this.budget.sessionContext, remainingBudget)
        const truncated = truncateToTokenBudget(contextParts, sectionBudget)
        if (truncated) {
          sections.push(`## Session Context\n${truncated}`)
        }
      }
    }

    if (sections.length === 0) return ''

    return sections.join('\n\n')
  }

  private buildSessionContextSection(ctx: SessionContext): string {
    const parts: string[] = []

    if (ctx.activeFiles.length > 0) {
      parts.push(
        'Previously accessed files:\n' +
        ctx.activeFiles.map((f) => `- ${f}`).join('\n')
      )
    }

    if (ctx.conversationSummary) {
      parts.push(`Prior context:\n${ctx.conversationSummary}`)
    }

    return parts.join('\n\n')
  }
}
