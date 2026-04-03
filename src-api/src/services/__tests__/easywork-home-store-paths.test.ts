import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('store persistence honors EASYWORK_HOME', () => {
  let originalEasyWorkHome: string | undefined
  let tempEasyWorkHome = ''
  let secondaryEasyWorkHome = ''

  beforeEach(() => {
    originalEasyWorkHome = process.env.EASYWORK_HOME
    tempEasyWorkHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-store-home-'))
    process.env.EASYWORK_HOME = tempEasyWorkHome
    vi.resetModules()
  })

  afterEach(() => {
    if (originalEasyWorkHome === undefined) {
      delete process.env.EASYWORK_HOME
    } else {
      process.env.EASYWORK_HOME = originalEasyWorkHome
    }
    if (tempEasyWorkHome) {
      fs.rmSync(tempEasyWorkHome, { recursive: true, force: true })
    }
    if (secondaryEasyWorkHome) {
      fs.rmSync(secondaryEasyWorkHome, { recursive: true, force: true })
    }
  })

  it('writes settings.json to EASYWORK_HOME', async () => {
    const { saveSettingsToFile } = await import('../../settings-store')

    saveSettingsToFile({
      activeProviderId: null,
      providers: [],
    })

    expect(fs.existsSync(path.join(tempEasyWorkHome, 'settings.json'))).toBe(true)
  })

  it('writes runtime stores to EASYWORK_HOME', async () => {
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

    expect(fs.existsSync(path.join(tempEasyWorkHome, 'approval-requests.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempEasyWorkHome, 'turn-runtime.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempEasyWorkHome, 'plans.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempEasyWorkHome, 'scheduled-tasks.json'))).toBe(true)
  })

  it('re-resolves planStore singleton path after EASYWORK_HOME changes', async () => {
    const { planStore } = await import('../plan-store')
    secondaryEasyWorkHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-store-home-next-'))
    process.env.EASYWORK_HOME = secondaryEasyWorkHome

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

    expect(fs.existsSync(path.join(secondaryEasyWorkHome, 'plans.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempEasyWorkHome, 'plans.json'))).toBe(false)
  })
})
