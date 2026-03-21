import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage, ProviderConfig } from '@shared-types'
import type { AgentRunOptions, IAgent } from '../../core/agent/interface'
import { AgentService } from '../agent-service'

describe('AgentService', () => {
  let workDir: string
  let provider: ProviderConfig

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-'))
    provider = {
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    } as ProviderConfig
  })

  it('loads and saves session context, and injects it into system prompt', async () => {
    const sessionId = 'session-with-context'
    const sessionDir = path.join(workDir, 'sessions', sessionId)
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, 'context.json'),
      JSON.stringify({
        sessionId,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        conversationSummary: 'previous research summary',
        activeFiles: ['/tmp/previous.ts'],
        taskHistory: [],
      }),
      'utf8'
    )

    let capturedOptions: AgentRunOptions | undefined
    const fakeAgent: IAgent = {
      async run() {
        return []
      },
      async *stream(_prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage> {
        capturedOptions = options
        yield {
          id: 'done',
          type: 'done',
          timestamp: Date.now(),
        }
      },
      abort() {
        return
      },
      getSession() {
        return null
      },
    }

    const service = new AgentService({ provider, workDir })
    vi.spyOn(service, 'createAgent').mockReturnValue(fakeAgent)

    const messages: AgentMessage[] = []
    for await (const message of service.streamExecution('继续处理这个会话', sessionId)) {
      messages.push(message)
    }

    expect(messages).toHaveLength(1)
    expect(capturedOptions?.contextManager).toBeDefined()
    expect(capturedOptions?.systemPrompt).toContain('previous research summary')
    expect(capturedOptions?.systemPrompt).toContain('/tmp/previous.ts')

    const savedContext = JSON.parse(
      fs.readFileSync(path.join(sessionDir, 'context.json'), 'utf8')
    ) as { lastActiveAt?: string }
    expect(typeof savedContext.lastActiveAt).toBe('string')
  })
})
