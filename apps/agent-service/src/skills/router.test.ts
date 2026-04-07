import { describe, expect, it } from 'vitest'
import { filterEnabledSkills } from './router'
import type { SkillSettings } from '../settings-store'

describe('filterEnabledSkills', () => {
  const skills = [
    { id: 'project:deep-research', name: 'deep-research' },
    { id: 'project:playwright-cli', name: 'playwright-cli' },
  ]

  it('excludes manually disabled skills from the available set', () => {
    const settings: SkillSettings = {
      enabled: true,
      skills: {
        'project:deep-research': {
          enabled: false,
          providers: { claude: true, codex: false, gemini: false },
        },
      },
    }

    expect(filterEnabledSkills(skills, 'claude', settings)).toEqual([
      { id: 'project:playwright-cli', name: 'playwright-cli' },
    ])
  })

  it('returns no skills when global skill switch is disabled', () => {
    const settings: SkillSettings = {
      enabled: false,
    }

    expect(filterEnabledSkills(skills, 'claude', settings)).toEqual([])
  })
})
