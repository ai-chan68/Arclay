import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage, ProviderConfig } from '@shared-types'
import type { AgentRunOptions, IAgent } from '../../core/agent/interface'
import { AgentService } from '../agent-service'

describe('AgentService', () => {
  let workDir: string
  let provider: ProviderConfig
  let originalEasyWorkHome: string | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-'))
    provider = {
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    } as ProviderConfig
    originalEasyWorkHome = process.env.EASYWORK_HOME
  })

  afterEach(() => {
    if (originalEasyWorkHome === undefined) {
      delete process.env.EASYWORK_HOME
      return
    }

    process.env.EASYWORK_HOME = originalEasyWorkHome
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

  it('writes append-only metrics with artifacts and attempt numbers when a task run completes', async () => {
    const sessionId = 'session-metrics'
    const taskId = 'task_metrics'
    const metricsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-home-'))
    process.env.EASYWORK_HOME = metricsHome

    const fakeAgent: IAgent = {
      async run() {
        return []
      },
      async *stream(): AsyncIterable<AgentMessage> {
        yield {
          id: 'tool-result-1',
          type: 'tool_result',
          toolOutput: JSON.stringify({
            artifacts: ['/tmp/output/report.md'],
          }),
          timestamp: Date.now(),
        }
        yield {
          id: 'warning-1',
          type: 'text',
          role: 'assistant',
          content: 'Warning: something is off',
          isTemporary: true,
          timestamp: Date.now(),
        }
        yield {
          id: 'done-1',
          type: 'done',
          timestamp: Date.now(),
          providerResultSubtype: 'max_turns',
          providerDurationMs: 1200,
          providerTotalCostUsd: 0.42,
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

    for await (const _message of service.streamExecution('记录 metrics', sessionId, undefined, undefined, {
      taskId,
    })) {
      // noop
    }

    for await (const _message of service.streamExecution('再次记录 metrics', sessionId, undefined, undefined, {
      taskId,
    })) {
      // noop
    }

    const month = new Date().toISOString().slice(0, 7)
    const metricsPath = path.join(metricsHome, 'metrics', `${month}.jsonl`)
    const lines = fs.readFileSync(metricsPath, 'utf8').trim().split('\n').filter(Boolean)
    const records = lines.map((line) => JSON.parse(line))

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      taskId,
      runId: sessionId,
      attempt: 1,
      success: true,
      provider: 'claude',
      model: 'test-model',
      artifacts: ['/tmp/output/report.md'],
      providerResultSubtype: 'max_turns',
      providerDurationMs: 1200,
      providerTotalCostUsd: 0.42,
      warningCount: 1,
      errorCount: 0,
    })
    expect(records[1]).toMatchObject({
      taskId,
      runId: sessionId,
      attempt: 2,
      success: true,
    })
    expect(typeof records[0].durationMs).toBe('number')
    expect(typeof records[0].ts).toBe('string')
  })
})
