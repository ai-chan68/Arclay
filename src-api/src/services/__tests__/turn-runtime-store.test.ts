import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('TurnRuntimeStore dependency resolution', () => {
  let oldHome: string | undefined
  let tempHome = ''

  beforeEach(() => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-turn-runtime-store-'))
    process.env.HOME = tempHome
    vi.resetModules()
  })

  afterEach(() => {
    process.env.HOME = oldHome
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it('does not block a turn when explicit dependency is already cancelled', async () => {
    const { TurnRuntimeStore } = await import('../turn-runtime-store')
    const store = new TurnRuntimeStore()
    const taskId = `task_${Date.now()}`

    const firstTurn = store.createTurn({
      taskId,
      prompt: 'first',
    }).turn
    store.cancelTurn(firstTurn.id, 'Cancelled during planning')

    const secondTurn = store.createTurn({
      taskId,
      prompt: 'second',
      dependsOnTurnIds: [firstTurn.id],
    }).turn

    expect(secondTurn.state).toBe('queued')
    expect(secondTurn.blockedByTurnIds).toEqual([])
    expect(secondTurn.reason).toBeNull()
  })

  it('unblocks blocked turns on startup sweep when predecessor was interrupted', async () => {
    const { TurnRuntimeStore } = await import('../turn-runtime-store')
    const store = new TurnRuntimeStore()
    const taskId = `task_${Date.now()}`

    const firstTurn = store.createTurn({
      taskId,
      prompt: 'first',
    }).turn
    store.markTurnPlanning(firstTurn.id)

    const secondTurn = store.createTurn({
      taskId,
      prompt: 'second',
    }).turn

    expect(secondTurn.state).toBe('blocked')
    expect(secondTurn.blockedByTurnIds).toContain(firstTurn.id)

    const sweepResult = store.sweepOnStartup()
    expect(sweepResult.interruptedTurnCount).toBeGreaterThan(0)

    const firstAfter = store.getTurn(firstTurn.id)
    const secondAfter = store.getTurn(secondTurn.id)

    expect(firstAfter?.state).toBe('failed')
    expect(secondAfter?.state).toBe('queued')
    expect(secondAfter?.blockedByTurnIds).toEqual([])
    expect(secondAfter?.reason).toBeNull()
  })

  it('cancels approval-waiting turns on startup sweep instead of marking them failed', async () => {
    const { TurnRuntimeStore } = await import('../turn-runtime-store')
    const store = new TurnRuntimeStore()
    const taskId = `task_${Date.now()}`

    const turn = store.createTurn({
      taskId,
      prompt: 'awaiting approval',
    }).turn
    store.markTurnPlanning(turn.id)
    store.markTurnAwaitingApproval(turn.id)

    const sweepResult = store.sweepOnStartup()

    expect(sweepResult.interruptedTurnCount).toBe(1)
    expect(store.getTurn(turn.id)?.state).toBe('cancelled')
    expect(store.getTurn(turn.id)?.reason).toBe('API process restarted before approval was resolved.')
  })
})
