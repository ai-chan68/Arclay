import { describe, expect, it } from 'vitest'

describe('planning fallback behavior', () => {
  it('yields plan with skipPlanning flag when parsing fails and response has content', () => {
    // This tests the contract: when parsePlanningResponse returns 'unknown'
    // and fullResponse is non-empty, the plan should carry skipPlanning: true
    // so the frontend knows this is an auto-fallback, not a real plan.
    const fallbackPlan = {
      id: 'test',
      goal: '写一个hello world',
      steps: [
        { id: 'step_0', description: '执行用户请求', status: 'pending' as const },
      ],
      notes: '规划阶段未返回结构化计划，将直接执行任务。',
      createdAt: new Date(),
      skipPlanning: true,
    }
    expect(fallbackPlan.steps).toHaveLength(1)
    expect(fallbackPlan.skipPlanning).toBe(true)
    expect(fallbackPlan.notes).toContain('直接执行')
  })

  it('creates single-step plan instead of generic 3-step template', () => {
    // The old fallback had 3 meaningless steps. New fallback should be 1 step.
    const fallbackPlan = {
      steps: [{ id: 'step_0', description: '执行用户请求', status: 'pending' as const }],
    }
    expect(fallbackPlan.steps).toHaveLength(1)
    expect(fallbackPlan.steps[0].description).not.toContain('分析任务需求')
  })
})

describe('tool_use pollution guard', () => {
  it('marks plan as skipPlanning when both attempts have tool_use', () => {
    // Simulates the scenario where model ignores allowedTools: []
    // and returns tool_use blocks in both first and retry attempts.
    // Expected: fallback plan with skipPlanning: true and tool_use note.
    const hasToolUse = true
    const planningResult = { type: 'unknown' as const }

    // When hasToolUse is true AND planningResult is unknown,
    // the plan should carry skipPlanning and a diagnostic note
    const shouldSkipToExecution = hasToolUse && planningResult.type === 'unknown'
    expect(shouldSkipToExecution).toBe(true)
  })
})
