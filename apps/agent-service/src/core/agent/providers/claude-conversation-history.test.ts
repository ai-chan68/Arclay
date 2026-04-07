import { describe, expect, it } from 'vitest'
import { ClaudeAgent } from './claude'

function makeAgent(maxHistoryTokens?: number) {
  const agent = new ClaudeAgent({ provider: 'claude', apiKey: 'test', model: 'claude-sonnet-4-5' })
  if (maxHistoryTokens !== undefined) {
    ;(agent as unknown as { config: { providerConfig: Record<string, unknown> } })
      .config.providerConfig = { maxHistoryTokens }
  }
  return agent
}

function callFormat(agent: ClaudeAgent, conversation: Array<{role: 'user'|'assistant', content: string, imagePaths?: string[]}>) {
  return (agent as unknown as {
    formatConversationHistory: (conv: typeof conversation) => string
  }).formatConversationHistory(conversation)
}

describe('formatConversationHistory', () => {
  it('includes messages beyond the last 3 when token budget allows', () => {
    // 5 messages, each ~4 chars = ~1 token, budget 2000 — all 5 should appear
    const agent = makeAgent(2000)
    const conversation = [
      { role: 'user' as const, content: 'msg1' },
      { role: 'assistant' as const, content: 'msg2' },
      { role: 'user' as const, content: 'msg3' },
      { role: 'assistant' as const, content: 'msg4' },
      { role: 'user' as const, content: 'msg5' },
    ]
    const result = callFormat(agent, conversation)
    expect(result).toContain('msg1')
    expect(result).toContain('msg5')
  })

  it('truncates oldest messages when token budget is exceeded', () => {
    // Each message "message number N" is ~17 chars = ~5 tokens
    // Budget 20 tokens fits ~4 messages, not all 10
    const agent = makeAgent(20)
    const conversation = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message number ${i}`,
    }))
    const result = callFormat(agent, conversation)
    expect(result).toContain('message number 9') // newest must be present
    expect(result).not.toContain('message number 0') // oldest should be dropped
  })

  it('always keeps at least 3 most recent messages regardless of budget', () => {
    // Budget 1 token — would exclude everything, but min 3 must survive
    const agent = makeAgent(1)
    const conversation = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'second' },
      { role: 'user' as const, content: 'third' },
    ]
    const result = callFormat(agent, conversation)
    expect(result).toContain('first')
    expect(result).toContain('third')
  })

  it('uses a more conservative token estimate for chinese-heavy content', () => {
    const agent = makeAgent(40)
    const conversation = [
      { role: 'user' as const, content: '这是第一条中文消息这是第一条中文消息这是第一条中文消息' },
      { role: 'assistant' as const, content: 'short english reply' },
      { role: 'user' as const, content: 'tail' },
    ]
    const result = callFormat(agent, conversation)
    // With 1 char = 2 tokens, the 30-char chinese message is 60 tokens, exceeding the 40 limit.
    // Since it's within the 3 minMessagesToKeep, it MUST be included even if it exceeds budget.
    expect(result).toContain('这是第一条中文消息')
    expect(result).toContain('tail')
  })

  it('skips an oversized old message and keeps smaller later messages when budget allows', () => {
    const agent = makeAgent(30)
    const conversation = [
      { role: 'user' as const, content: 'A'.repeat(200) },
      { role: 'assistant' as const, content: 'small-1' },
      { role: 'user' as const, content: 'small-2' },
      { role: 'assistant' as const, content: 'small-3' },
      { role: 'user' as const, content: 'small-4' },
      { role: 'assistant' as const, content: 'small-5' },
      { role: 'user' as const, content: 'small-6' },
    ]
    const result = callFormat(agent, conversation)
    // With minMessagesToKeep = 5, the last 5 messages are kept (small-2 through small-6).
    // A.repeat(200) and small-1 are outside the minimum 5, so they can be dropped if budget is tight.
    expect(result).toContain('small-6')
    expect(result).toContain('small-2')
    expect(result).not.toContain('A'.repeat(200))
  })

  it('respects configurable maxHistoryTokens up to 8000', () => {
    const agent = makeAgent(8000)
    // 30 messages, each ~100 chars Chinese = ~200 tokens = ~6000 total
    const conversation = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `这是第${i}条消息，包含一些中文内容用于测试token估算的准确性`,
    }))
    const result = callFormat(agent, conversation)
    // With 8000 budget, all 30 messages should fit (~6000 tokens)
    expect(result).toContain('这是第0条消息')
    expect(result).toContain('这是第29条消息')
    expect(result).not.toContain('[Note: Conversation history truncated')
  })

  it('keeps at least 5 most recent messages with new minimum', () => {
    const agent = makeAgent(1) // tiny budget
    const conversation = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg${i}`,
    }))
    const result = callFormat(agent, conversation)
    // Last 5 must survive regardless of budget
    expect(result).toContain('msg3')
    expect(result).toContain('msg7')
  })
})
