import { describe, expect, it } from 'vitest'

import type { Artifact } from '../../../../src/shared/types/artifacts'
import { filterArtifactsForDisplay } from '../../../../src/shared/lib/file-utils'

describe('filterArtifactsForDisplay', () => {
  it('keeps only canonical turn artifact files when explicit artifacts are available', () => {
    const artifacts: Artifact[] = [
      {
        id: 'final-artifact',
        name: 'claude-code-tips-chinese.md',
        path: '/tmp/sessions/task_1/turns/turn_1/artifacts/final/claude-code-tips-chinese.md',
        type: 'markdown',
      },
      {
        id: 'turn-evaluation',
        name: 'evaluation.md',
        path: '/tmp/sessions/task_1/turns/turn_1/evaluation.md',
        type: 'markdown',
      },
      {
        id: 'mentioned-settings',
        name: 'settings.json',
        path: '/Users/demo/.claude/settings.json',
        type: 'json',
      },
    ]

    expect(filterArtifactsForDisplay(artifacts)).toEqual([
      {
        id: 'final-artifact',
        name: 'claude-code-tips-chinese.md',
        path: '/tmp/sessions/task_1/turns/turn_1/artifacts/final/claude-code-tips-chinese.md',
        type: 'markdown',
      },
    ])
  })

  it('returns empty when there are no canonical turn artifact files', () => {
    const artifacts: Artifact[] = [
      {
        id: 'turn-evaluation',
        name: 'evaluation.md',
        path: '/tmp/sessions/task_1/turns/turn_1/evaluation.md',
        type: 'markdown',
      },
      {
        id: 'mentioned-settings',
        name: 'settings.json',
        path: '/Users/demo/.claude/settings.json',
        type: 'json',
      },
    ]

    expect(filterArtifactsForDisplay(artifacts)).toEqual([])
  })
})
