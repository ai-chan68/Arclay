import { describe, expect, it } from 'vitest'
import type { TaskPlan } from '@shared-types'
import { ClaudeAgent } from './claude'

function createPlan(): TaskPlan {
  return {
    id: 'plan-1',
    goal: 'Summarize a Feishu document',
    steps: [
      {
        id: 'step_1',
        description: 'Use Feishu MCP to open the document',
        status: 'pending',
      },
      {
        id: 'step_2',
        description: 'Summarize the document content',
        status: 'pending',
      },
    ],
    createdAt: new Date('2026-03-17T00:00:00.000Z'),
  }
}

describe('Claude MCP execution guidance', () => {
  it('tells execution runs to use only session-provided MCP servers', () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const prompt = agent.formatPlanForExecution(
      createPlan(),
      '/tmp/easywork-session'
    )

    expect(prompt).toContain('Use only the MCP servers that are already available in this session')
    expect(prompt).toContain('Do NOT inspect other applications')
    expect(prompt).toContain('Do NOT scan the home directory')
    expect(prompt).toContain('If the required MCP server is unavailable, report that it is not configured for the current application')
    expect(prompt).toContain('These files are pre-created before execution starts')
    expect(prompt).toContain('Use Read before the first Edit on any of them')
    expect(prompt).toContain('Do NOT use Write to replace task_plan.md, findings.md, or progress.md')
  })
})
