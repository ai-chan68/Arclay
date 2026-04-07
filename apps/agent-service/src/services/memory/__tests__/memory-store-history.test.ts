import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { HistoryRecord } from '../types'
import { MemoryStore } from '../memory-store'

describe('MemoryStore history helpers', () => {
  let tmpDir: string
  let store: MemoryStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-store-history-'))
    store = new MemoryStore(tmpDir, 'task_history_test')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes task-level history records with full identity fields', async () => {
    const record: HistoryRecord = {
      timestamp: '2026-03-31T00:00:00.000Z',
      sessionId: 'session_task',
      taskId: 'task_history_test',
      turnId: null,
      runId: 'run_task',
      type: 'agent_response',
      content: 'task history entry',
    }

    await store.appendTaskHistory('task_history_test', record)

    const raw = fs
      .readFileSync(path.join(tmpDir, 'sessions', 'task_history_test', 'history.jsonl'), 'utf-8')
      .trim()
    const parsed = JSON.parse(raw) as HistoryRecord

    expect(parsed).toEqual(record)
  })

  it('writes turn-level history records to the correct folder', async () => {
    const record: HistoryRecord = {
      timestamp: '2026-03-31T00:00:01.000Z',
      sessionId: 'session_turn',
      taskId: 'task_history_test',
      turnId: 'turn_1',
      runId: 'run_turn',
      type: 'tool_use',
      content: 'turn history entry',
      metadata: { toolName: 'mock-tool' },
    }

    await store.appendTurnHistory('task_history_test', 'turn_1', record)

    const pathOnDisk = path.join(
      tmpDir,
      'sessions',
      'task_history_test',
      'turns',
      'turn_1',
      'history.jsonl'
    )
    const raw = fs.readFileSync(pathOnDisk, 'utf-8').trim()
    expect(JSON.parse(raw)).toEqual(record)
  })
})
