import { describe, expect, it } from 'vitest'

import { AgentRunStore } from '../agent-run-store'

describe('AgentRunStore', () => {
  it('stops an active run, aborts its controller, and cancels the bound turn', () => {
    const store = new AgentRunStore()
    const run = store.createRun('execute', 'session_run_stop_1')
    let canceledTurnId: string | null = null
    let canceledReason: string | null = null

    const result = store.stopRun(run.id, {
      findLatestTurnByRun: () => ({ id: 'turn_run_stop_1' }),
      cancelTurn: (turnId, reason) => {
        canceledTurnId = turnId
        canceledReason = reason || null
      },
    })

    expect(result).toEqual({
      status: 'stopped',
      source: 'active_run',
      turnId: 'turn_run_stop_1',
    })
    expect(run.isAborted).toBe(true)
    expect(run.abortController.signal.aborted).toBe(true)
    expect(store.getRun(run.id)).toBeNull()
    expect(canceledTurnId).toBe('turn_run_stop_1')
    expect(canceledReason).toBe('Session stopped by user.')
  })

  it('falls back to provider abort when no active run exists and still cancels the bound turn', () => {
    const store = new AgentRunStore()
    let canceledTurnId: string | null = null

    const result = store.stopRun('session_run_stop_2', {
      abortAgentSession: (sessionId) => sessionId === 'session_run_stop_2',
      findLatestTurnByRun: () => ({ id: 'turn_run_stop_2' }),
      cancelTurn: (turnId) => {
        canceledTurnId = turnId
      },
    })

    expect(result).toEqual({
      status: 'stopped',
      source: 'agent_service',
      turnId: 'turn_run_stop_2',
    })
    expect(canceledTurnId).toBe('turn_run_stop_2')
  })

  it('returns not_found when neither active run nor provider abort can stop the session', () => {
    const store = new AgentRunStore()

    const result = store.stopRun('session_run_stop_3', {
      abortAgentSession: () => false,
      findLatestTurnByRun: () => ({ id: 'turn_run_stop_3' }),
      cancelTurn: () => {
        throw new Error('should not cancel turn when stop fails')
      },
    })

    expect(result).toEqual({
      status: 'not_found',
      source: null,
      turnId: null,
    })
  })
})
