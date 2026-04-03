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
      {
        id: 'turn-evaluation',
        name: 'evaluation.md',
        path: '/tmp/sessions/task_1/turns/turn_1/evaluation.md',
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

    expect(filterArtifactsForDisplay(artifacts)).toEqual([
      {
        id: 'turn-evaluation',
        name: 'evaluation.md',
        path: '/tmp/sessions/task_1/turns/turn_1/evaluation.md',
        type: 'markdown',
      },
    ])
  })

  it('shows planning documents as session artifacts', () => {
    const artifacts: Artifact[] = [
      {
        id: 'task-plan',
        name: 'task_plan.md',
        path: '/tmp/sessions/task_1/task_plan.md',
        type: 'markdown',
      },
      {
        id: 'progress-log',
        name: 'progress.md',
        path: '/tmp/sessions/task_1/progress.md',
        type: 'markdown',
      },
    ]

    expect(filterArtifactsForDisplay(artifacts)).toEqual(artifacts)
  })

  it('filters out non-session files even when they use session document names', () => {
    const artifacts: Artifact[] = [
      {
        id: 'fake-task-plan',
        name: 'task_plan.md',
        path: '/tmp/task_plan.md',
        type: 'markdown',
      },
      {
        id: 'fake-progress',
        name: 'progress.md',
        path: '/Users/demo/progress.md',
        type: 'markdown',
      },
      {
        id: 'real-session-plan',
        name: 'task_plan.md',
        path: '/tmp/sessions/task_1/task_plan.md',
        type: 'markdown',
      },
    ]

    expect(filterArtifactsForDisplay(artifacts)).toEqual([
      {
        id: 'real-session-plan',
        name: 'task_plan.md',
        path: '/tmp/sessions/task_1/task_plan.md',
        type: 'markdown',
      },
    ])
  })

  it('filters out lookalike sessions paths that do not match EasyWork session layout', () => {
    const artifacts: Artifact[] = [
      {
        id: 'release-progress',
        name: 'progress.md',
        path: '/repo/sessions/release/progress.md',
        type: 'markdown',
      },
      {
        id: 'logs-history',
        name: 'history.jsonl',
        path: '/project/sessions/logs/history.jsonl',
        type: 'text',
      },
      {
        id: 'real-interleaved',
        name: 'history.jsonl',
        path: '/repo/sessions/task_42/interleaved/history.jsonl',
        type: 'text',
      },
      {
        id: 'real-turn-evaluation',
        name: 'evaluation.md',
        path: '/repo/sessions/task_42/turns/turn_7/evaluation.md',
        type: 'markdown',
      },
    ]

    expect(filterArtifactsForDisplay(artifacts)).toEqual([
      {
        id: 'real-interleaved',
        name: 'history.jsonl',
        path: '/repo/sessions/task_42/interleaved/history.jsonl',
        type: 'text',
      },
      {
        id: 'real-turn-evaluation',
        name: 'evaluation.md',
        path: '/repo/sessions/task_42/turns/turn_7/evaluation.md',
        type: 'markdown',
      },
    ])
  })
})
