import { describe, expect, it } from 'vitest'
import {
  buildExecutionPrompt,
  formatPlanForExecutionFallback,
  getPlanningFilesProtocolInstruction,
} from '../plan-execution'

describe('plan-execution', () => {
  it('mentions turn-level evaluation guidance in the planning files protocol', () => {
    const instruction = getPlanningFilesProtocolInstruction()

    expect(instruction).toContain('turns/<turn_id>/evaluation.md')
    expect(instruction).toContain('Do NOT create or overwrite a task-level `evaluation.md`')
    expect(instruction).toContain("prefer the current turn's `evaluation.md`")
  })

  it('includes evaluation guidance in the fallback execution prompt', () => {
    const prompt = formatPlanForExecutionFallback({
      goal: 'Audit session quality',
      steps: [{ description: 'Review the session artifacts' }],
      notes: 'Focus on execution path and artifacts',
    }, '/workspace')

    expect(prompt).toContain('turns/<turn_id>/evaluation.md')
    expect(prompt).toContain('Planning Files Protocol')
  })

  it('preserves original request when building the final execution prompt', () => {
    const prompt = buildExecutionPrompt({
      goal: 'Audit session quality',
      steps: [{ description: 'Review the session artifacts' }],
    }, 'Assess whether this session met expectations', '/workspace')

    expect(prompt).toContain('Original request: Assess whether this session met expectations')
  })
})
