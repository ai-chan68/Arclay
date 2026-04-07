import { afterEach, describe, expect, it } from 'vitest'

import {
  addBackgroundTask,
  clearAllBackgroundTasks,
  getBackgroundTask,
  updateBackgroundTaskPhase,
} from '../../../../src/shared/lib/background-tasks'

describe('background task runtime phase tracking', () => {
  afterEach(() => {
    clearAllBackgroundTasks()
  })

  it('stores the detached task phase when moving a run to the background', () => {
    addBackgroundTask({
      taskId: 'task_bg_phase_1',
      sessionId: 'session_bg_phase_1',
      prompt: '继续处理任务',
      title: '后台任务',
      status: 'running',
      phase: 'planning',
      isRunning: true,
      messages: [],
      abortController: new AbortController(),
    })

    expect(getBackgroundTask('task_bg_phase_1')?.phase).toBe('planning')
  })

  it('updates the tracked phase while the background stream continues', () => {
    addBackgroundTask({
      taskId: 'task_bg_phase_2',
      sessionId: 'session_bg_phase_2',
      prompt: '继续处理任务',
      title: '后台任务',
      status: 'running',
      phase: 'planning',
      isRunning: true,
      messages: [],
      abortController: new AbortController(),
    })

    updateBackgroundTaskPhase('task_bg_phase_2', 'blocked')

    expect(getBackgroundTask('task_bg_phase_2')?.phase).toBe('blocked')
  })
})
