import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('store persistence honors ARCLAY_HOME', () => {
  let originalArclayHome: string | undefined
  let tempArclayHome = ''
  let secondaryArclayHome = ''

  beforeEach(() => {
    originalArclayHome = process.env.ARCLAY_HOME
    tempArclayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arclay-store-home-'))
    process.env.ARCLAY_HOME = tempArclayHome
    vi.resetModules()
  })

  afterEach(() => {
    if (originalArclayHome === undefined) {
      delete process.env.ARCLAY_HOME
    } else {
      process.env.ARCLAY_HOME = originalArclayHome
    }
    if (tempArclayHome) {
      fs.rmSync(tempArclayHome, { recursive: true, force: true })
    }
    if (secondaryArclayHome) {
      fs.rmSync(secondaryArclayHome, { recursive: true, force: true })
    }
  })

  it('writes settings.json to ARCLAY_HOME', async () => {
    const { saveSettingsToFile } = await import('../../settings-store')

    saveSettingsToFile({
      activeProviderId: null,
      providers: [],
    })

    expect(fs.existsSync(path.join(tempArclayHome, 'settings.json'))).toBe(true)
  })

  it('writes runtime stores to ARCLAY_HOME', async () => {
    const { approvalStore } = await import('../approval-store')
    const { turnRuntimeStore } = await import('../turn-runtime-store')
    const { planStore } = await import('../plan-store')
    const { scheduledTaskStore } = await import('../scheduled-task-store')

    approvalStore.upsertPendingPermission({
      id: 'perm-home-path',
      type: 'file_write',
      title: 'Write file',
      description: 'Verify store path',
    })

    turnRuntimeStore.createTurn({
      taskId: 'task-home-path',
      prompt: 'hello',
    })

    planStore.upsertPendingPlan(
      {
        id: 'plan-home-path',
        goal: 'verify store path',
        steps: [],
        createdAt: new Date(),
      },
      {
        taskId: 'task-home-path',
        runId: 'run-home-path',
        turnId: 'turn-home-path',
      }
    )

    scheduledTaskStore.createTask({
      workspaceId: 'ws_default',
      name: 'home path task',
      cronExpr: '*/10 * * * *',
      sourcePrompt: 'hello',
      approvedPlan: {
        id: 'scheduled-plan-home-path',
        goal: 'scheduled task goal',
        steps: [],
        createdAt: new Date(),
      },
      executionPromptSnapshot: 'hello',
    })

    expect(fs.existsSync(path.join(tempArclayHome, 'approval-requests.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempArclayHome, 'turn-runtime.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempArclayHome, 'plans.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempArclayHome, 'scheduled-tasks.json'))).toBe(true)
  })

  it('re-resolves planStore singleton path after ARCLAY_HOME changes', async () => {
    const { planStore } = await import('../plan-store')
    secondaryArclayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arclay-store-home-next-'))
    process.env.ARCLAY_HOME = secondaryArclayHome

    planStore.upsertPendingPlan(
      {
        id: 'plan-home-path-singleton',
        goal: 'verify singleton store path',
        steps: [],
        createdAt: new Date(),
      },
      {
        taskId: 'task-home-path',
        runId: 'run-home-path',
        turnId: 'turn-home-path',
      }
    )

    expect(fs.existsSync(path.join(secondaryArclayHome, 'plans.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempArclayHome, 'plans.json'))).toBe(false)
  })
})
