/**
 * Result Aggregator - Combines subtask results into final output
 */

import type { SubTaskResult, MultiAgentCost } from '@shared-types'

export interface AggregationResult {
  summary: string
  details: string[]
  successes: number
  failures: number
  partialSuccess: boolean
  cost?: MultiAgentCost
}

export class ResultAggregator {
  /**
   * Aggregate subtask results into a coherent summary
   */
  aggregate(results: SubTaskResult[]): AggregationResult {
    const successes = results.filter(r => r.status === 'success')
    const failures = results.filter(r => r.status === 'failed')
    const timeouts = results.filter(r => r.status === 'timeout')

    const details = this.buildDetails(successes, failures, timeouts)
    const summary = this.buildSummary(successes, failures, timeouts)
    const cost = this.calculateCost(results)

    return {
      summary,
      details,
      successes: successes.length,
      failures: failures.length + timeouts.length,
      partialSuccess: successes.length > 0 && (failures.length > 0 || timeouts.length > 0),
      cost
    }
  }

  /**
   * Build detailed breakdown of results
   */
  private buildDetails(
    successes: SubTaskResult[],
    failures: SubTaskResult[],
    timeouts: SubTaskResult[]
  ): string[] {
    const details: string[] = []

    if (successes.length > 0) {
      details.push(`\n## ✅ Completed (${successes.length})`)
      successes.forEach((r, index) => {
        details.push(`\n### Task ${index + 1}`)
        // 完整输出，不截断
        if (r.output) {
          details.push(r.output)
        } else {
          details.push('_No output generated_')
        }
        details.push('') // 空行分隔
      })
    }

    if (failures.length > 0) {
      details.push(`\n## ❌ Failed (${failures.length})`)
      failures.forEach(r => {
        details.push(`\n**Task ID**: ${r.subtaskId}`)
        details.push(`**Error**: ${r.error || 'Unknown error'}`)
        details.push('')
      })
    }

    if (timeouts.length > 0) {
      details.push(`\n## ⏱️ Timed Out (${timeouts.length})`)
      timeouts.forEach(r => {
        details.push(`- Task ${r.subtaskId}: Exceeded timeout limit`)
      })
    }

    return details
  }

  /**
   * Build high-level summary
   */
  private buildSummary(
    successes: SubTaskResult[],
    failures: SubTaskResult[],
    timeouts: SubTaskResult[]
  ): string {
    const total = successes.length + failures.length + timeouts.length

    if (failures.length === 0 && timeouts.length === 0) {
      return `# ✨ Task Completed Successfully\n\nAll ${total} tasks have been completed by the agent team.`
    }

    if (successes.length === 0) {
      return `# ❌ Task Failed\n\nUnfortunately, all ${total} tasks failed. Please check the errors below.`
    }

    return `# ⚠️ Partial Completion\n\n${successes.length} out of ${total} tasks succeeded, while ${failures.length + timeouts.length} encountered issues.`
  }

  /**
   * Calculate total cost from results
   */
  private calculateCost(results: SubTaskResult[]): MultiAgentCost {
    let totalInput = 0
    let totalOutput = 0

    results.forEach(r => {
      if (r.tokenUsage) {
        totalInput += r.tokenUsage.input
        totalOutput += r.tokenUsage.output
      }
    })

    const total = totalInput + totalOutput

    // Rough cost estimation (these are approximate rates)
    // Opus: $15/1M input, $75/1M output
    // Sonnet: $3/1M input, $15/1M output
    const estimatedCost = (totalInput * 0.000003) + (totalOutput * 0.000015)

    return {
      estimated: 0, // Will be filled by orchestrator
      actual: estimatedCost,
      breakdown: {
        orchestrator: 0, // Will be filled by orchestrator
        subAgents: estimatedCost
      },
      tokens: {
        input: totalInput,
        output: totalOutput,
        total
      }
    }
  }
}
