import { describe, it, expect, vi } from 'vitest'
import { TaskPlanner } from '../task-planner'
import type { TaskPlan } from '../../types/agent-new'

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    id: 'plan-1',
    goal: '调研泰格医药公司信息',
    steps: [
      { id: 'step_1', description: '搜索公司基本信息', status: 'pending' },
      { id: 'step_2', description: '分析股价走势', status: 'pending' },
    ],
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('TaskPlanner', () => {
  const planner = new TaskPlanner()

  describe('formatForExecution()', () => {
    it('includes workDir in output', () => {
      const result = planner.formatForExecution(makePlan(), '/tmp/session')
      expect(result).toContain('/tmp/session')
    })

    it('includes plan goal', () => {
      const result = planner.formatForExecution(makePlan(), '/tmp/session')
      expect(result).toContain('调研泰格医药公司信息')
    })

    it('includes all step descriptions', () => {
      const result = planner.formatForExecution(makePlan(), '/tmp/session')
      expect(result).toContain('搜索公司基本信息')
      expect(result).toContain('分析股价走势')
    })

    it('includes notes when present', () => {
      const plan = makePlan({ notes: '重点关注近三个月数据' })
      const result = planner.formatForExecution(plan, '/tmp/session')
      expect(result).toContain('重点关注近三个月数据')
    })

    it('injects web information policy for web info tasks', () => {
      const plan = makePlan({
        goal: '访问 https://example.com 提取页面内容',
        steps: [{ id: 'step_1', description: '读取页面数据', status: 'pending' }],
      })
      const result = planner.formatForExecution(plan, '/tmp/session')
      expect(result).toContain('Web Information Collection Policy')
    })

    it('includes TodoWrite initial todos json', () => {
      const result = planner.formatForExecution(makePlan(), '/tmp/session')
      expect(result).toContain('TodoWrite')
      expect(result).toContain('in_progress')
    })
  })

  describe('plan()', () => {
    it('delegates to agent.plan()', () => {
      const mockIterable = (async function* () { yield { id: '1', type: 'text' as const, role: 'assistant' as const, content: 'ok', timestamp: 0 } })()
      const mockAgent = { plan: vi.fn().mockReturnValue(mockIterable) } as any
      const result = planner.plan(mockAgent, 'test prompt')
      expect(mockAgent.plan).toHaveBeenCalledWith('test prompt', undefined)
      expect(result).toBe(mockIterable)
    })

    it('returns undefined when agent has no plan method', () => {
      const mockAgent = {} as any
      const result = planner.plan(mockAgent, 'test')
      expect(result).toBeUndefined()
    })
  })
})
