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

  it('uses the task workspace as the storage root when taskId is provided', async () => {
    const sessionId = 'run_123'
    const taskId = 'task_storage_root'
    const taskDir = path.join(workDir, 'sessions', taskId)
    fs.mkdirSync(taskDir, { recursive: true })
    fs.writeFileSync(
      path.join(taskDir, 'context.json'),
      JSON.stringify({
        sessionId,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        conversationSummary: 'task scoped summary',
        activeFiles: ['/tmp/task-scoped.ts'],
        taskHistory: [taskId],
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

    for await (const _message of service.streamExecution('继续处理这个任务', sessionId, undefined, undefined, {
      taskId,
    })) {
      // noop
    }

    expect(capturedOptions?.systemPrompt).toContain('task scoped summary')
    expect(capturedOptions?.systemPrompt).toContain('/tmp/task-scoped.ts')
    expect(fs.existsSync(path.join(taskDir, 'context.json'))).toBe(true)
    expect(fs.existsSync(path.join(workDir, 'sessions', sessionId, 'context.json'))).toBe(false)
  })

  it('records history in both task and turn ledgers when turnId is provided', async () => {
    const sessionId = 'session-with-turn-history'
    const taskId = 'task_turn_history'
    const turnId = 'turn_dual_write'

    const fakeAgent: IAgent = {
      async run() {
        return []
      },
      async *stream() {
        yield {
          id: 'msg-turn',
          type: 'text',
          role: 'assistant',
          content: 'turn complete',
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

    for await (const _message of service.streamExecution('test turn history', sessionId, undefined, undefined, {
      taskId,
      turnId,
    })) {
      // noop
    }

    const taskLines = fs
      .readFileSync(path.join(workDir, 'sessions', taskId, 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
    const turnLines = fs
      .readFileSync(
        path.join(workDir, 'sessions', taskId, 'turns', turnId, 'history.jsonl'),
        'utf8'
      )
      .trim()
      .split('\n')
      .filter(Boolean)

    expect(taskLines).toHaveLength(turnLines.length)
    const taskRecords = taskLines.map((line) => JSON.parse(line))
    const turnRecords = turnLines.map((line) => JSON.parse(line))
    expect(taskRecords).toEqual(turnRecords)
  })
})
