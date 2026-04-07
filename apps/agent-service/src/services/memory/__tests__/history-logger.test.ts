import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentMessage } from '@shared-types'
import { HistoryLogger } from '../history-logger'
import { MemoryStore } from '../memory-store'

describe('HistoryLogger', () => {
  let tmpDir: string
  let store: MemoryStore
  let logger: HistoryLogger

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-logger-'))
    store = new MemoryStore(tmpDir, 'task_1')
    logger = new HistoryLogger(store, {
      sessionId: 'run_1',
      taskId: 'task_1',
      turnId: 'turn_1',
      runId: 'run_1',
    })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes the same record to task and turn history', async () => {
    await logger.logAgentMessage({
      id: 'msg-1',
      type: 'text',
      role: 'assistant',
      content: 'done',
      timestamp: Date.now(),
    } as AgentMessage)

    const taskPath = path.join(tmpDir, 'sessions', 'task_1', 'history.jsonl')
    const turnPath = path.join(tmpDir, 'sessions', 'task_1', 'turns', 'turn_1', 'history.jsonl')

    const taskLines = fs.readFileSync(taskPath, 'utf8').trim().split('\n')
    const turnLines = fs.readFileSync(turnPath, 'utf8').trim().split('\n')

    expect(taskLines).toHaveLength(1)
    expect(turnLines).toHaveLength(1)
    expect(JSON.parse(taskLines[0])).toEqual(JSON.parse(turnLines[0]))
  })
})
