/**
 * Daily Memory — generates episodic memory from session history
 *
 * After each execution, extracts a structured summary from history.jsonl
 * and appends it to memory/daily/YYYY-MM-DD.md.
 *
 * No LLM calls — uses structural extraction from HistoryRecord fields.
 */

import type { HistoryRecord } from './types'
import type { MemoryStore } from './memory-store'

const MAX_FILES_IN_SUMMARY = 15
const MAX_GOALS_IN_SUMMARY = 5
const MAX_ERRORS_IN_SUMMARY = 5

interface SessionSummary {
  goals: string[]
  keyFiles: string[]
  errors: string[]
  toolCount: number
  startTime: string | null
  endTime: string | null
}

function extractSessionSummary(records: HistoryRecord[]): SessionSummary {
  const goals: string[] = []
  const fileSet = new Set<string>()
  const errors: string[] = []
  let toolCount = 0
  let startTime: string | null = null
  let endTime: string | null = null

  for (const record of records) {
    if (!startTime) startTime = record.timestamp
    endTime = record.timestamp

    switch (record.type) {
      case 'plan': {
        // Extract goal from plan content like "goal: ..."
        const goalMatch = record.content.match(/^goal:\s*(.+)/i)
        if (goalMatch && goals.length < MAX_GOALS_IN_SUMMARY) {
          goals.push(goalMatch[1].trim())
        }
        break
      }

      case 'tool_use': {
        toolCount++
        // Extract file paths from tool content like "write: /path/to/file"
        const meta = record.metadata as Record<string, unknown> | undefined
        const toolName = meta?.toolName as string | undefined
        if (toolName === 'write' || toolName === 'edit' || toolName === 'read') {
          const pathMatch = record.content.match(/^(?:write|edit|read):\s*(.+)/i)
          if (pathMatch) {
            fileSet.add(pathMatch[1].trim().split(/\s/)[0])
          }
        }
        break
      }

      case 'error': {
        if (errors.length < MAX_ERRORS_IN_SUMMARY && record.content.trim()) {
          errors.push(record.content.trim().slice(0, 200))
        }
        break
      }
    }
  }

  return {
    goals,
    keyFiles: [...fileSet].slice(0, MAX_FILES_IN_SUMMARY),
    errors,
    toolCount,
    startTime,
    endTime,
  }
}

function formatDailySummary(sessionId: string, summary: SessionSummary): string {
  const time = summary.startTime
    ? new Date(summary.startTime).toTimeString().slice(0, 5)
    : 'unknown'

  const goalText = summary.goals.length > 0
    ? summary.goals.map((g) => `- ${g}`).join('\n')
    : '- (no plan recorded)'

  const parts = [
    `## ${time} — Session ${sessionId.slice(0, 12)}`,
    `### Tasks\n${goalText}`,
  ]

  if (summary.keyFiles.length > 0) {
    parts.push(`### Key Files\n${summary.keyFiles.map((f) => `- ${f}`).join('\n')}`)
  }

  if (summary.errors.length > 0) {
    parts.push(`### Issues\n${summary.errors.map((e) => `- ${e}`).join('\n')}`)
  }

  parts.push(`_Tools used: ${summary.toolCount}_`)

  return parts.join('\n\n')
}

/**
 * Generate a daily memory entry from a session's history.jsonl
 * and append it to memory/daily/YYYY-MM-DD.md.
 *
 * Returns the generated summary text, or empty string if no records found.
 */
export async function generateDailySummary(
  sessionId: string,
  store: MemoryStore
): Promise<string> {
  const records = await store.loadHistory(sessionId)
  if (records.length === 0) return ''

  const summary = extractSessionSummary(records)
  const text = formatDailySummary(sessionId, summary)
  const today = new Date().toISOString().slice(0, 10)

  await store.appendDailyMemory(today, text)

  return text
}
