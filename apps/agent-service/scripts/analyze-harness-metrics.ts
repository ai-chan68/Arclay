import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

interface MetricsRecord {
  ts: string
  taskId: string
  runId: string
  attempt: number
  success: boolean
  durationMs: number
  model: string
  provider: string
  artifacts: string[]
  providerResultSubtype?: string
  providerDurationMs?: number
  providerTotalCostUsd?: number
  warningCount?: number
  errorCount?: number
}

async function analyzeMetrics() {
  const arclayHome = process.env.ARCLAY_HOME || join(homedir(), '.arclay')
  const metricsDir = join(arclayHome, 'metrics')

  try {
    const files = await readdir(metricsDir)
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))

    if (jsonlFiles.length === 0) {
      console.log('No metrics files found.')
      return
    }

    const allRecords: MetricsRecord[] = []

    for (const file of jsonlFiles) {
      const content = await readFile(join(metricsDir, file), 'utf8')
      const lines = content.trim().split('\n')
      for (const line of lines) {
        try {
          allRecords.push(JSON.parse(line))
        } catch (e) {
          // skip invalid lines
        }
      }
    }

    if (allRecords.length === 0) {
      console.log('No valid records found.')
      return
    }

    // Overall Stats
    const totalRuns = allRecords.length
    const successfulRuns = allRecords.filter(r => r.success).length
    const passRate = (successfulRuns / totalRuns * 100).toFixed(2)
    const avgDuration = (allRecords.reduce((acc, r) => acc + r.durationMs, 0) / totalRuns / 1000).toFixed(2)
    const totalCost = allRecords.reduce((acc, r) => acc + (r.providerTotalCostUsd || 0), 0).toFixed(4)

    console.log('--- Overall Harness Metrics ---')
    console.log(`Total Runs:      ${totalRuns}`)
    console.log(`Success Rate:    ${passRate}%`)
    console.log(`Avg Duration:    ${avgDuration}s`)
    console.log(`Total LLM Cost:  $${totalCost}`)
    console.log('')

    // Pass@1 Calculation
    // group by runId (which in our metrics is the sessionId/taskRunId)
    const runGroups = new Map<string, MetricsRecord[]>()
    for (const r of allRecords) {
      const key = `${r.taskId}:${r.runId}`
      const group = runGroups.get(key) || []
      group.push(r)
      runGroups.set(key, group)
    }

    let passAt1Count = 0
    for (const group of runGroups.values()) {
      const attempt1 = group.find(r => r.attempt === 1)
      if (attempt1 && attempt1.success) {
        passAt1Count++
      }
    }
    const passAt1Rate = (passAt1Count / runGroups.size * 100).toFixed(2)
    console.log(`Pass@1 Rate:     ${passAt1Rate}% (First-attempt success)`)

    // Top Models / Providers
    const modelStats = new Map<string, { total: number, success: number }>()
    for (const r of allRecords) {
      const stats = modelStats.get(r.model) || { total: 0, success: 0 }
      stats.total++
      if (r.success) stats.success++
      modelStats.set(r.model, stats)
    }

    console.log('\n--- Performance by Model ---')
    for (const [model, stats] of modelStats.entries()) {
      const rate = (stats.success / stats.total * 100).toFixed(2)
      console.log(`${model.padEnd(20)}: ${rate}% success (${stats.total} runs)`)
    }

    // Warning/Error Analysis
    const totalWarnings = allRecords.reduce((acc, r) => acc + (r.warningCount || 0), 0)
    const totalErrors = allRecords.reduce((acc, r) => acc + (r.errorCount || 0), 0)
    console.log('\n--- Reliability ---')
    console.log(`Total Warnings:  ${totalWarnings}`)
    console.log(`Total Errors:    ${totalErrors}`)
    console.log(`Avg Warnings/Run: ${(totalWarnings / totalRuns).toFixed(2)}`)

  } catch (err) {
    if ((err as any).code === 'ENOENT') {
      console.log('Metrics directory not found.')
    } else {
      console.error('Failed to analyze metrics:', err)
    }
  }
}

analyzeMetrics()
