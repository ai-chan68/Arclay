/**
 * MemoryRetriever — keyword-based memory search
 *
 * Supports CJK bigram tokenization for Chinese text
 * and standard word tokenization for English.
 * Scores memory sections by keyword overlap.
 */

import { MemoryStore } from './memory-store'

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2f800-\u2fa1f]/
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'and', 'or', 'but', 'not', 'so', 'if', 'then', 'that', 'this', 'it',
])

function isCjk(char: string): boolean {
  return CJK_RANGE.test(char)
}

/**
 * CJK bigram tokenization (unigram + bigram for each CJK character).
 */
function cjkBigrams(text: string): string[] {
  const chars = [...text]
  const tokens: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (isCjk(chars[i])) {
      tokens.push(chars[i])
      if (i + 1 < chars.length && isCjk(chars[i + 1])) {
        tokens.push(chars[i] + chars[i + 1])
      }
    }
  }
  return tokens
}

/**
 * English word tokenization with stop word removal.
 */
function englishTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

/**
 * Parse query into keyword tokens (mixed CJK + English).
 */
export function parseQuery(query: string): string[] {
  const tokens: string[] = []
  tokens.push(...cjkBigrams(query))
  tokens.push(...englishTokens(query))
  return [...new Set(tokens)]
}

// ---------------------------------------------------------------------------
// Section scoring
// ---------------------------------------------------------------------------

interface MemorySection {
  heading: string
  content: string
  score: number
}

function splitIntoSections(text: string): MemorySection[] {
  const sections: MemorySection[] = []
  const blocks = text.split(/^### /m)

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const newlineIdx = trimmed.indexOf('\n')
    const heading = newlineIdx > 0 ? trimmed.slice(0, newlineIdx).trim() : trimmed
    const content = newlineIdx > 0 ? trimmed.slice(newlineIdx + 1).trim() : ''
    sections.push({ heading, content, score: 0 })
  }

  return sections
}

function scoreSection(section: MemorySection, queryTokens: string[]): number {
  let score = 0
  const headingLower = section.heading.toLowerCase()
  const contentLower = section.content.toLowerCase()

  for (const token of queryTokens) {
    if (headingLower.includes(token)) score += 5
    if (contentLower.includes(token)) score += 1
  }

  return score
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  heading: string
  content: string
  score: number
}

/**
 * Search global memory (memory.md) for sections matching the query.
 * Returns top-K results sorted by relevance score.
 */
export async function searchMemory(
  store: MemoryStore,
  query: string,
  limit = 5
): Promise<RetrievalResult[]> {
  const globalMemory = await store.loadGlobalMemory()
  if (!globalMemory.trim()) return []

  const queryTokens = parseQuery(query)
  if (queryTokens.length === 0) return []

  const sections = splitIntoSections(globalMemory)

  for (const section of sections) {
    section.score = scoreSection(section, queryTokens)
  }

  return sections
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ heading, content, score }) => ({ heading, content, score }))
}
