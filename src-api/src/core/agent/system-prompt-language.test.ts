import { describe, expect, it } from 'vitest'
import { getDefaultSystemPrompt, getPlanningInstruction } from './system-prompt'

describe('agent language instructions', () => {
  it('requires simplified Chinese for normal agent dialogue', () => {
    const prompt = getDefaultSystemPrompt('/tmp/easywork-session')

    expect(prompt).toContain('Simplified Chinese')
    expect(prompt).toContain('unless the user explicitly requests another language')
  })

  it('requires simplified Chinese for planning outputs', () => {
    const instruction = getPlanningInstruction()

    expect(instruction).toContain('All user-facing text in the JSON fields must be in Simplified Chinese')
    expect(instruction).toContain('goal')
    expect(instruction).toContain('steps')
    expect(instruction).toContain('question')
  })
})
