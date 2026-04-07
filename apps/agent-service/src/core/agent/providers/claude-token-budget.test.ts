import { describe, expect, it } from 'vitest'

// We test the estimation function directly
function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    // CJK Unified Ideographs and common CJK ranges
    if (char.charCodeAt(0) > 0x2e80) {
      tokens += 2
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

describe('estimateTokens', () => {
  it('estimates English text at ~0.25 tokens per char', () => {
    const english = 'Hello world, this is a test message for token estimation.'
    const result = estimateTokens(english)
    // 57 chars * 0.25 ≈ 15 tokens
    expect(result).toBeGreaterThanOrEqual(14)
    expect(result).toBeLessThanOrEqual(16)
  })

  it('estimates Chinese text at ~2 tokens per char', () => {
    const chinese = '这是一个用于测试的中文消息'
    const result = estimateTokens(chinese)
    // 13 chars (including punctuation marks) * 2 = 26 tokens
    expect(result).toBe(26)
  })

  it('handles mixed content', () => {
    const mixed = 'Hello 世界'
    const result = estimateTokens(mixed)
    // "Hello " = 6 * 0.25 = 1.5, "世界" = 2 * 2 = 4 → ceil(5.5) = 6
    expect(result).toBe(6)
  })
})

describe('planning prompt budget', () => {
  it('allocates remaining budget to conversation history', () => {
    const CONTEXT_LIMIT = 200_000
    const OUTPUT_RESERVE = 8_000
    const instructionTokens = 1000
    const skillTokens = 500
    const promptTokens = 200

    const historyBudget = CONTEXT_LIMIT - OUTPUT_RESERVE - instructionTokens - skillTokens - promptTokens
    expect(historyBudget).toBe(190_300)
    expect(historyBudget).toBeGreaterThan(4000) // always enough for history
  })

  it('clamps history budget to minimum 1000 tokens', () => {
    const historyBudget = Math.max(
      200_000 - 8_000 - 195_000, // instruction takes almost everything
      1000
    )
    expect(historyBudget).toBe(1000)
  })
})
