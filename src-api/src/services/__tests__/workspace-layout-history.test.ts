import { describe, expect, it } from 'vitest'
import {
  resolveTaskHistoryPath,
  resolveTurnHistoryPath,
} from '../workspace-layout'

describe('workspace history paths', () => {
  it('builds task and turn history paths under the same task root', () => {
    expect(resolveTaskHistoryPath('/tmp/work', 'task_1')).toBe(
      '/tmp/work/sessions/task_1/history.jsonl'
    )
    expect(resolveTurnHistoryPath('/tmp/work', 'task_1', 'turn_2')).toBe(
      '/tmp/work/sessions/task_1/turns/turn_2/history.jsonl'
    )
  })
})
