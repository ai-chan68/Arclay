export type AgentRunPhase = 'plan' | 'execute'

export interface AgentRun {
  id: string
  createdAt: Date
  phase: AgentRunPhase
  isAborted: boolean
  abortController: AbortController
}

export interface AgentRunStopOptions<TTurn extends { id: string }> {
  abortAgentSession?: (sessionId: string) => boolean
  findLatestTurnByRun?: (runId: string) => TTurn | null
  cancelTurn?: (turnId: string, reason?: string) => void
  cancelReason?: string
}

export interface AgentRunStopResult {
  status: 'stopped' | 'not_found'
  source: 'active_run' | 'agent_service' | null
  turnId: string | null
}

export class AgentRunStore {
  private activeRuns = new Map<string, AgentRun>()

  createRun(phase: AgentRunPhase, preferredId?: string): AgentRun {
    const normalizedPreferredId = typeof preferredId === 'string' ? preferredId.trim() : ''
    const id = normalizedPreferredId || `run_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const run: AgentRun = {
      id,
      createdAt: new Date(),
      phase,
      isAborted: false,
      abortController: new AbortController(),
    }
    this.activeRuns.set(id, run)
    return run
  }

  getRun(runId: string): AgentRun | null {
    return this.activeRuns.get(runId) || null
  }

  deleteRun(runId: string): void {
    const run = this.activeRuns.get(runId)
    if (!run) return

    run.abortController.abort()
    this.activeRuns.delete(runId)
  }

  stopRun<TTurn extends { id: string }>(
    sessionId: string,
    options: AgentRunStopOptions<TTurn> = {}
  ): AgentRunStopResult {
    const cancelReason = options.cancelReason || 'Session stopped by user.'
    const cancelBoundTurn = (): string | null => {
      const turn = options.findLatestTurnByRun?.(sessionId) || null
      if (turn) {
        options.cancelTurn?.(turn.id, cancelReason)
        return turn.id
      }
      return null
    }

    const run = this.activeRuns.get(sessionId)
    if (run) {
      run.isAborted = true
      run.abortController.abort()
      const turnId = cancelBoundTurn()
      this.deleteRun(sessionId)
      return {
        status: 'stopped',
        source: 'active_run',
        turnId,
      }
    }

    if (options.abortAgentSession?.(sessionId)) {
      return {
        status: 'stopped',
        source: 'agent_service',
        turnId: cancelBoundTurn(),
      }
    }

    return {
      status: 'not_found',
      source: null,
      turnId: null,
    }
  }
}

export const agentRunStore = new AgentRunStore()
