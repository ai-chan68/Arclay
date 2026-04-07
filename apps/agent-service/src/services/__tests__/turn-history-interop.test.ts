import { describe, expect, it } from 'vitest'

import type { Artifact } from '../../../../src/shared/types/artifacts'
import { filterArtifactsForDisplay, isSessionDocumentFile } from '../../../../src/shared/lib/file-utils'

describe('turn history interop', () => {
  it('keeps history.jsonl as a visible session document artifact', () => {
    const historyArtifact: Artifact = {
      id: 'history-jsonl',
      name: 'history.jsonl',
      path: '/tmp/sessions/task_history/interleaved/history.jsonl',
      type: 'text',
    }

    expect(isSessionDocumentFile(historyArtifact.path)).toBe(true)
    expect(filterArtifactsForDisplay([historyArtifact])).toEqual([historyArtifact])
  })

  it('surfaces legacy planning documents alongside session history', () => {
    const planningArtifact: Artifact = {
      id: 'task-plan',
      name: 'task_plan.md',
      path: '/tmp/sessions/task_history/task_plan.md',
      type: 'markdown',
    }

    expect(isSessionDocumentFile(planningArtifact.path)).toBe(true)
    expect(filterArtifactsForDisplay([planningArtifact])).toEqual([planningArtifact])
  })

  it('does not treat same-name files outside sessions as session documents', () => {
    const nonSessionPlanningArtifact: Artifact = {
      id: 'task-plan-outside-session',
      name: 'task_plan.md',
      path: '/tmp/task_plan.md',
      type: 'markdown',
    }

    expect(isSessionDocumentFile(nonSessionPlanningArtifact.path)).toBe(false)
    expect(filterArtifactsForDisplay([nonSessionPlanningArtifact])).toEqual([])
  })

  it('does not treat broad /sessions/* lookalikes as session docs', () => {
    expect(isSessionDocumentFile('/repo/sessions/release/progress.md')).toBe(false)
    expect(isSessionDocumentFile('/project/sessions/logs/history.jsonl')).toBe(false)
    expect(isSessionDocumentFile('/repo/sessions/task_1/turns/tmp/evaluation.md')).toBe(false)
  })
})
