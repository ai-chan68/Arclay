import { describe, expect, it } from 'vitest'
import { getDefaultSystemPrompt, getPlanningInstruction } from './system-prompt'

describe('agent language instructions', () => {
  it('keeps only the business-specific default system prompt guidance', () => {
    const prompt = getDefaultSystemPrompt('/tmp/easywork-session')

    expect(prompt).toContain('Simplified Chinese')
    expect(prompt).toContain('MANDATORY OUTPUT DIRECTORY: /tmp/easywork-session')
    expect(prompt).toContain('Use the append tool to write each item one at a time')
    expect(prompt).toContain('.xlsx')
    expect(prompt).toContain('pandas')
    expect(prompt).toContain('unless the user explicitly requests another language')
    expect(prompt).not.toContain('## Available Tools')
    expect(prompt).not.toContain('YOU MUST USE TOOL CALLS')
  })

  it('requires simplified Chinese for planning outputs', () => {
    const instruction = getPlanningInstruction()

    expect(instruction).toContain('All user-facing text in the JSON fields must be in Simplified Chinese')
    expect(instruction).toContain('goal')
    expect(instruction).toContain('steps')
    expect(instruction).toContain('question')
  })
})
