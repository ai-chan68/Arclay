/**
 * MemoryStore — file-system based memory persistence
 *
 * Layout:
 *   {workDir}/memory.md                          Global semantic memory
 *   {workDir}/memory/daily/YYYY-MM-DD.md         Daily episodic memory
 *   {workDir}/memory/daily/archive.md            Archived daily memories (30d+)
 *   {workDir}/sessions/{id}/history.jsonl        Per-session execution trace
 */

import { join } from 'path'
import { readFile, appendFile, mkdir, readdir, rename, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { MemoryEntry, HistoryRecord } from './types'

const MEMORY_FILE = 'memory.md'
const DAILY_DIR = 'memory/daily'
const ARCHIVE_FILE = 'archive.md'
const HISTORY_FILE = 'history.jsonl'

// Head+tail truncation constants
const HEAD_RATIO = 0.75
const TRUNCATION_MARKER = '\n\n[...truncated...]\n\n'

/**
 * Estimate token count for mixed CJK/Latin text.
 * CJK characters ≈ 1 token each; Latin words ≈ 1 token per ~4 chars.
 * Rough average: chars / 2.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 2)
}

/**
 * Truncate content to fit within a token budget using head+tail strategy.
 * Preserves the beginning (75%) and end (25%) of the content.
 */
export function truncateToTokenBudget(content: string, budgetTokens: number): string {
  if (!content) return ''
  if (estimateTokens(content) <= budgetTokens) return content

  const charBudget = budgetTokens * 2 // reverse estimate
  const markerLen = TRUNCATION_MARKER.length
  const usable = charBudget - markerLen
  if (usable <= 0) return ''

  const headSize = Math.floor(usable * HEAD_RATIO)
  const tailSize = usable - headSize

  return content.slice(0, headSize) + TRUNCATION_MARKER + content.slice(-tailSize)
}

export class MemoryStore {
  private readonly workDir: string

  constructor(workDir: string) {
    this.workDir = workDir
  }

  // ---------------------------------------------------------------------------
  // Global semantic memory (memory.md)
  // ---------------------------------------------------------------------------

  private get memoryPath(): string {
    return join(this.workDir, MEMORY_FILE)
  }

  async loadGlobalMemory(): Promise<string> {
    try {
      return await readFile(this.memoryPath, 'utf-8')
    } catch {
      return ''
    }
  }

  async appendGlobalMemory(entry: MemoryEntry): Promise<void> {
    const ts = entry.timestamp || new Date().toISOString()
    const block = `\n### [${ts}] ${entry.category}\n${entry.content.trim()}\n`
    await this.ensureDir(this.workDir)
    await appendFile(this.memoryPath, block, 'utf-8')
  }

  // ---------------------------------------------------------------------------
  // Daily episodic memory (memory/daily/YYYY-MM-DD.md)
  // ---------------------------------------------------------------------------

  private dailyDir(): string {
    return join(this.workDir, DAILY_DIR)
  }

  private dailyPath(date: string): string {
    return join(this.dailyDir(), `${date}.md`)
  }

  async loadDailyMemory(date: string): Promise<string> {
    try {
      return await readFile(this.dailyPath(date), 'utf-8')
    } catch {
      return ''
    }
  }

  async appendDailyMemory(date: string, content: string): Promise<void> {
    await this.ensureDir(this.dailyDir())
    await appendFile(this.dailyPath(date), content.trim() + '\n\n', 'utf-8')
  }

  /**
   * Load daily memories for the most recent N days (sorted newest first).
   */
  async loadRecentDailyMemories(days = 2): Promise<string> {
    const dir = this.dailyDir()
    if (!existsSync(dir)) return ''

    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return ''
    }

    // Filter dated markdown files (YYYY-MM-DD.md), sort descending
    const dated = files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, days)

    const parts: string[] = []
    for (const file of dated) {
      try {
        const content = await readFile(join(dir, file), 'utf-8')
        if (content.trim()) {
          parts.push(`### ${file.replace('.md', '')}\n${content.trim()}`)
        }
      } catch {
        // skip unreadable files
      }
    }

    return parts.join('\n\n')
  }

  // ---------------------------------------------------------------------------
  // JSONL session history
  // ---------------------------------------------------------------------------

  private historyPath(sessionId: string): string {
    return join(this.workDir, 'sessions', sessionId, HISTORY_FILE)
  }

  async appendHistory(sessionId: string, record: HistoryRecord): Promise<void> {
    const dir = join(this.workDir, 'sessions', sessionId)
    await this.ensureDir(dir)
    const line = JSON.stringify(record) + '\n'
    await appendFile(this.historyPath(sessionId), line, 'utf-8')
  }

  async loadHistory(sessionId: string): Promise<HistoryRecord[]> {
    let raw: string
    try {
      raw = await readFile(this.historyPath(sessionId), 'utf-8')
    } catch {
      return []
    }

    const records: HistoryRecord[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        records.push(JSON.parse(trimmed) as HistoryRecord)
      } catch {
        // skip malformed lines
      }
    }
    return records
  }

  // ---------------------------------------------------------------------------
  // Archive — move old daily memories to archive.md
  // ---------------------------------------------------------------------------

  async archiveDailyMemories(olderThanDays = 30): Promise<number> {
    const dir = this.dailyDir()
    if (!existsSync(dir)) return 0

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - olderThanDays)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return 0
    }

    const toArchive = files.filter((f) => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
      return match && match[1] < cutoffStr
    })

    if (toArchive.length === 0) return 0

    const archivePath = join(dir, ARCHIVE_FILE)
    for (const file of toArchive) {
      try {
        const content = await readFile(join(dir, file), 'utf-8')
        const date = file.replace('.md', '')
        const entry = `\n## ${date}\n${content.trim()}\n`
        await appendFile(archivePath, entry, 'utf-8')
        // Rename to .archived instead of delete (recoverable)
        await rename(join(dir, file), join(dir, file + '.archived'))
      } catch {
        // skip on error, don't break the loop
      }
    }

    return toArchive.length
  }

  /**
   * Scan daily memories older than promoteDays for candidate long-term entries
   * and append them to memory.md.
   */
  async promoteCandidates(promoteDays = 7): Promise<number> {
    const dir = this.dailyDir()
    if (!existsSync(dir)) return 0

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - promoteDays)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return 0
    }

    const candidates = files.filter((f) => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
      return match && match[1] < cutoffStr
    })

    let promoted = 0
    for (const file of candidates) {
      try {
        const content = await readFile(join(dir, file), 'utf-8')
        // Look for sections marked as candidate long-term memory
        const marker = /## (?:Candidate Long-Term|To Remember)\n([\s\S]*?)(?=\n## |\n$)/gi
        let match: RegExpExecArray | null
        while ((match = marker.exec(content)) !== null) {
          const body = match[1].trim()
          if (body.length < 50) continue // skip trivial entries
          if (await this.isAlreadyPromoted(body)) continue

          const date = file.replace('.md', '')
          await this.appendGlobalMemory({
            timestamp: new Date().toISOString(),
            source: 'system',
            category: 'fact',
            content: `<!-- promoted from ${date} -->\n${body}`,
          })
          promoted++
        }
      } catch {
        // skip on error
      }
    }

    return promoted
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }

  private async isAlreadyPromoted(content: string): Promise<boolean> {
    const existing = await this.loadGlobalMemory()
    // Check first 60 chars as fingerprint to avoid duplicates
    const fingerprint = content.slice(0, 60).trim()
    return existing.includes(fingerprint)
  }
}
