import { describe, expect, it } from 'vitest'
import { ClaudeAgent } from './claude'

describe('Claude execution result metadata', () => {
  it('extracts stop metadata from raw sdk result messages', () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const extractProviderCompletionMetadata = (agent as unknown as {
      extractProviderCompletionMetadata: (message: unknown) => Record<string, unknown> | null
    }).extractProviderCompletionMetadata

    expect(
      extractProviderCompletionMetadata({
        type: 'result',
        subtype: 'max_turns',
        stop_reason: 'Maximum turns reached',
        duration_ms: 1234,
        total_cost_usd: 0.42,
      })
    ).toEqual({
      providerResultSubtype: 'max_turns',
      providerStopReason: 'Maximum turns reached',
      providerDurationMs: 1234,
      providerTotalCostUsd: 0.42,
    })
  })
})
