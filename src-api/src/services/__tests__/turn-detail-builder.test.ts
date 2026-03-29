import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@shared-types'

import type { TurnRecord } from '../../types/turn-runtime'
import { buildTurnDetailSnapshot } from '../turn-detail-builder'

describe('buildTurnDetailSnapshot', () => {
  const turn: TurnRecord = {
    id: 'turn_1',
    taskId: 'task_1',
    runId: 'run_1',
    prompt: '请帮我导出 PDF',
    state: 'completed',
    readVersion: 0,
    writeVersion: 1,
    blockedByTurnIds: [],
    reason: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  it('extracts plan, final output text, and file artifacts from turn messages', () => {
    const messages: AgentMessage[] = [
      {
        id: 'plan_1',
        type: 'plan',
        timestamp: Date.now(),
        plan: {
          id: 'plan-1',
          goal: '生成 PDF 报告',
          steps: [
            { id: 'step_1', description: '读取项目', status: 'completed' },
            { id: 'step_2', description: '输出 PDF', status: 'completed' },
          ],
          createdAt: new Date(),
        },
      },
      {
        id: 'tool_use_1',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'tool_use_1',
        toolInput: {
          file_path: '/tmp/task_1/report.pdf',
        },
        timestamp: Date.now(),
      },
      {
        id: 'tool_result_1',
        type: 'tool_result',
        toolUseId: 'tool_use_1',
        toolOutput: 'Successfully wrote /tmp/task_1/report.pdf',
        timestamp: Date.now(),
      },
      {
        id: 'result_1',
        type: 'result',
        content: 'PDF 已生成，请查看 report.pdf',
        timestamp: Date.now(),
      },
    ]

    const snapshot = buildTurnDetailSnapshot({
      taskId: 'task_1',
      turn,
      messages,
    })

    expect(snapshot.planSnapshot?.goal).toBe('生成 PDF 报告')
    expect(snapshot.outputText).toBe('PDF 已生成，请查看 report.pdf')
    expect(snapshot.artifacts).toHaveLength(1)
    expect(snapshot.artifacts[0]?.path).toBe('/tmp/task_1/report.pdf')
    expect(snapshot.artifacts[0]?.type).toBe('pdf')
    expect(snapshot.summaryText).toContain('请帮我导出 PDF')
  })

  it('prefers the last substantive assistant response over a trailing completion note', () => {
    const messages: AgentMessage[] = [
      {
        id: 'assistant_1',
        type: 'text',
        role: 'assistant',
        content: '## 杭州今日天气\n\n- 天气：小雨\n- 气温：11℃ ~ 21℃\n- 建议：带伞出门',
        timestamp: Date.now(),
      },
      {
        id: 'assistant_2',
        type: 'text',
        role: 'assistant',
        content: '天气查询完成！杭州今天有小雨，出门记得带伞哦 🌂',
        timestamp: Date.now(),
      },
    ]

    const snapshot = buildTurnDetailSnapshot({
      taskId: 'task_1',
      turn,
      messages,
    })

    expect(snapshot.outputText).toBe('## 杭州今日天气\n\n- 天气：小雨\n- 气温：11℃ ~ 21℃\n- 建议：带伞出门')
  })
})
