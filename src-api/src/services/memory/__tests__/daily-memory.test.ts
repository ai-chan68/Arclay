import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HistoryRecord } from '../types'
import { generateDailySummary } from '../daily-memory'
import { MemoryStore } from '../memory-store'

describe('generateDailySummary', () => {
  let tmpDir = ''
  let store: MemoryStore

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-26T09:35:45.000Z'))
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-memory-'))
    store = new MemoryStore(tmpDir, 'task_daily_summary')
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('falls back to the provided goal when history does not contain a plan record', async () => {
    const records: HistoryRecord[] = [
      {
        timestamp: '2026-03-26T09:33:14.239Z',
        sessionId: 'run_1',
        taskId: 'task_daily_summary',
        turnId: null,
        runId: 'run_1',
        type: 'agent_response',
        content: '我来帮您查询今天杭州的天气情况。',
      },
      {
        timestamp: '2026-03-26T09:33:18.167Z',
        sessionId: 'run_1',
        taskId: 'task_daily_summary',
        turnId: null,
        runId: 'run_1',
        type: 'tool_use',
        content: 'WebSearch: {"query":"杭州今天天气 2026年3月26日"}',
        metadata: { toolName: 'WebSearch' },
      },
    ]

    for (const record of records) {
      await store.appendHistory('run_1', record)
    }

    const summary = await generateDailySummary('run_1', store, {
      fallbackGoal: '查询今天杭州的天气情况',
    })

    expect(summary).toContain('### Tasks\n- 查询今天杭州的天气情况')
    const dailyMemory = await store.loadDailyMemory('2026-03-26')
    expect(dailyMemory).toContain('### Tasks\n- 查询今天杭州的天气情况')
  })

  it('prefers the explicit plan goal when history includes one', async () => {
    const records: HistoryRecord[] = [
      {
        timestamp: '2026-03-26T09:33:14.239Z',
        sessionId: 'run_2',
        taskId: 'task_daily_summary',
        turnId: null,
        runId: 'run_2',
        type: 'plan',
        content: 'goal: 翻译GitHub项目中的所有46篇tip文章',
      },
    ]

    for (const record of records) {
      await store.appendHistory('run_2', record)
    }

    const summary = await generateDailySummary('run_2', store, {
      fallbackGoal: '查询今天杭州的天气情况',
    })

    expect(summary).toContain('### Tasks\n- 翻译GitHub项目中的所有46篇tip文章')
    expect(summary).not.toContain('### Tasks\n- 查询今天杭州的天气情况')
  })
})
