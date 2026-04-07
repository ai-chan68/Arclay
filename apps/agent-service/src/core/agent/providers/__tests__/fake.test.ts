import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@shared-types'
import type { AgentProviderConfig } from '../../types'
import { FakeAgent, FakeProvider, fakePlugin } from '../fake'

function makeConfig(overrides?: Record<string, unknown>): AgentProviderConfig {
  return {
    provider: 'fake',
    apiKey: 'not-needed',
    model: 'fake-model',
    providerConfig: overrides,
  }
}

async function collectMessages(iterable: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = []
  for await (const msg of iterable) {
    messages.push(msg)
  }
  return messages
}

describe('FakeProvider', () => {
  it('is always available', async () => {
    const provider = new FakeProvider()
    expect(await provider.isAvailable()).toBe(true)
  })

  it('validates any config', () => {
    const provider = new FakeProvider()
    expect(provider.validateConfig(makeConfig())).toBe(true)
  })

  it('returns fake-model as default', () => {
    const provider = new FakeProvider()
    expect(provider.getDefaultModel()).toBe('fake-model')
  })

  it('creates FakeAgent instances', () => {
    const provider = new FakeProvider()
    const agent = provider.createAgent(makeConfig())
    expect(agent).toBeInstanceOf(FakeAgent)
  })

  it('exports valid plugin metadata', () => {
    expect(fakePlugin.metadata.type).toBe('fake')
    expect(fakePlugin.metadata.capabilities.supportsStreaming).toBe(true)
    expect(fakePlugin.metadata.capabilities.supportsPlanning).toBe(true)
  })
})

describe('FakeAgent', () => {
  describe('echo scenario (default)', () => {
    it('echoes user prompt', async () => {
      const agent = new FakeAgent(makeConfig())
      const messages = await collectMessages(agent.stream('hello world'))

      expect(messages[0].type).toBe('session')
      expect(messages[1].type).toBe('text')
      expect(messages[1].content).toBe('Echo: hello world')
      expect(messages[2].type).toBe('done')
    })
  })

  describe('plan-and-execute scenario', () => {
    it('yields plan then text then done', async () => {
      const agent = new FakeAgent(makeConfig({ scenario: 'plan-and-execute' }))
      const messages = await collectMessages(agent.stream('build a feature'))

      const types = messages.map((m) => m.type)
      expect(types).toEqual(['session', 'plan', 'text', 'done'])
      expect(messages[1].plan).toBeDefined()
    })
  })

  describe('tool-use scenario', () => {
    it('yields tool_use then tool_result then text then done', async () => {
      const agent = new FakeAgent(makeConfig({ scenario: 'tool-use' }))
      const messages = await collectMessages(agent.stream('run a command'))

      const types = messages.map((m) => m.type)
      expect(types).toEqual(['session', 'tool_use', 'tool_result', 'text', 'done'])
      expect(messages[1].toolName).toBe('bash')
    })
  })

  describe('error scenario', () => {
    it('yields an error message', async () => {
      const agent = new FakeAgent(makeConfig({ scenario: 'error' }))
      const messages = await collectMessages(agent.stream('fail please'))

      const types = messages.map((m) => m.type)
      expect(types).toEqual(['session', 'error'])
      expect(messages[1].errorMessage).toContain('Simulated')
    })
  })

  describe('custom messages', () => {
    it('yields user-supplied messages', async () => {
      const custom: AgentMessage[] = [
        { id: 'c1', type: 'text', role: 'assistant', content: 'custom', timestamp: Date.now() },
      ]
      const agent = new FakeAgent(makeConfig({ messages: custom }))
      const messages = await collectMessages(agent.stream('anything'))

      expect(messages[0].type).toBe('session')
      expect(messages[1].content).toBe('custom')
    })
  })

  describe('abort', () => {
    it('stops yielding messages after abort', async () => {
      const manyMessages: AgentMessage[] = Array.from({ length: 100 }, (_, i) => ({
        id: `m-${i}`,
        type: 'text' as const,
        content: `msg ${i}`,
        timestamp: Date.now(),
      }))

      const controller = new AbortController()
      const agent = new FakeAgent(makeConfig({ messages: manyMessages, delayMs: 10 }))
      const collected: AgentMessage[] = []

      for await (const msg of agent.stream('go', { abortController: controller })) {
        collected.push(msg)
        if (collected.length === 5) {
          controller.abort()
        }
      }

      // session + 4 custom messages + possibly 1 more before break
      expect(collected.length).toBeLessThan(10)
    })
  })

  describe('session management', () => {
    it('emits session message with id', async () => {
      const agent = new FakeAgent(makeConfig())
      const messages = await collectMessages(agent.stream('test'))

      expect(messages[0].type).toBe('session')
      expect(messages[0].sessionId).toBeTruthy()
    })

    it('reuses session id when provided', async () => {
      const agent = new FakeAgent(makeConfig())
      const messages = await collectMessages(
        agent.stream('test', { sessionId: 'my-session' })
      )

      expect(messages[0].sessionId).toBe('my-session')
    })

    it('marks session as completed', async () => {
      const agent = new FakeAgent(makeConfig())
      await collectMessages(agent.stream('test'))

      expect(agent.getSession()?.status).toBe('completed')
    })
  })
})
