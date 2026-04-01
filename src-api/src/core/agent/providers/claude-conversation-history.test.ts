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
})
