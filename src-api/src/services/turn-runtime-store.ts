import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {
  CreateTurnInput,
  CreateTurnResult,
  ExecutionStartResult,
  TaskRuntimeRecord,
  TaskRuntimeStatus,
  TurnArtifactRecord,
  TurnRecord,
  TurnRuntimeStoreData,
  TurnState,
  TurnTransitionResult,
} from '../types/turn-runtime'

const STORE_DIR = path.join(os.homedir(), '.easywork')
const STORE_FILE = path.join(STORE_DIR, 'turn-runtime.json')
const STORE_VERSION = 1 as const

const TERMINAL_STATES: TurnState[] = ['completed', 'failed', 'cancelled']
const BLOCKING_STATES: TurnState[] = [
  'queued',
  'planning',
  'awaiting_approval',
  'awaiting_clarification',
  'executing',
  'blocked',
]

function createInitialData(): TurnRuntimeStoreData {
  return {
    version: STORE_VERSION,
    runtimes: [],
    turns: [],
    artifacts: [],
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isTurnState(value: unknown): value is TurnState {
  return [
    'queued',
    'planning',
    'awaiting_approval',
    'awaiting_clarification',
    'executing',
    'blocked',
    'completed',
    'failed',
    'cancelled',
  ].includes(String(value))
}

export class TurnRuntimeStore {
  private data: TurnRuntimeStoreData

  constructor() {
    this.data = this.load()
  }

  private ensureStoreDir(): void {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true })
    }
  }

  private normalizeRuntime(raw: unknown): TaskRuntimeRecord | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (typeof value.taskId !== 'string' || !value.taskId.trim()) return null
    const version = typeof value.version === 'number' && Number.isFinite(value.version)
      ? Math.max(0, Math.floor(value.version))
      : 0
    const status: TaskRuntimeStatus = ['idle', 'running', 'awaiting', 'blocked', 'error'].includes(String(value.status))
      ? value.status as TaskRuntimeStatus
      : 'idle'
    const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : Date.now()
    return {
      taskId: value.taskId,
      version,
      status,
      activeTurnId: typeof value.activeTurnId === 'string' && value.activeTurnId.trim()
        ? value.activeTurnId
        : null,
      updatedAt,
    }
  }

  private normalizeTurn(raw: unknown): TurnRecord | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id.trim()) return null
    if (typeof value.taskId !== 'string' || !value.taskId.trim()) return null
    if (!isTurnState(value.state)) return null
    const readVersion = typeof value.readVersion === 'number' && Number.isFinite(value.readVersion)
      ? Math.max(0, Math.floor(value.readVersion))
      : 0
    const writeVersion = typeof value.writeVersion === 'number' && Number.isFinite(value.writeVersion)
      ? Math.max(0, Math.floor(value.writeVersion))
      : null
    const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now()
    const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : createdAt
    return {
      id: value.id,
      taskId: value.taskId,
      runId: typeof value.runId === 'string' && value.runId.trim()
        ? value.runId
        : typeof value.sessionId === 'string' && value.sessionId.trim()
        ? value.sessionId
        : null,
      prompt: typeof value.prompt === 'string' ? value.prompt : '',
      state: value.state,
      readVersion,
      writeVersion,
      blockedByTurnIds: Array.isArray(value.blockedByTurnIds)
        ? value.blockedByTurnIds.filter((item): item is string => typeof item === 'string')
        : [],
      reason: typeof value.reason === 'string' ? value.reason : null,
      createdAt,
      updatedAt,
    }
  }

  private normalizeArtifact(raw: unknown): TurnArtifactRecord | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id.trim()) return null
    if (typeof value.taskId !== 'string' || !value.taskId.trim()) return null
    if (typeof value.turnId !== 'string' || !value.turnId.trim()) return null
    if (typeof value.content !== 'string') return null
    const type = ['summary', 'decision', 'output'].includes(String(value.type))
      ? value.type as TurnArtifactRecord['type']
      : 'output'
    const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now()
    return {
      id: value.id,
      taskId: value.taskId,
      turnId: value.turnId,
      type,
      content: value.content,
      createdAt,
    }
  }

  private load(): TurnRuntimeStoreData {
    try {
      if (!fs.existsSync(STORE_FILE)) {
        return createInitialData()
      }
      const text = fs.readFileSync(STORE_FILE, 'utf-8')
      const parsed = JSON.parse(text) as TurnRuntimeStoreData
      if (!parsed || typeof parsed !== 'object') return createInitialData()
      return {
        version: STORE_VERSION,
        runtimes: Array.isArray(parsed.runtimes)
          ? parsed.runtimes.map((item) => this.normalizeRuntime(item)).filter((item): item is TaskRuntimeRecord => !!item)
          : [],
        turns: Array.isArray(parsed.turns)
          ? parsed.turns.map((item) => this.normalizeTurn(item)).filter((item): item is TurnRecord => !!item)
          : [],
        artifacts: Array.isArray(parsed.artifacts)
          ? parsed.artifacts.map((item) => this.normalizeArtifact(item)).filter((item): item is TurnArtifactRecord => !!item)
          : [],
      }
    } catch (error) {
      console.error('[TurnRuntimeStore] Failed to load store:', error)
      return createInitialData()
    }
  }

  private persist(): void {
    try {
      this.ensureStoreDir()
      const tmpFile = `${STORE_FILE}.tmp`
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmpFile, STORE_FILE)
    } catch (error) {
      console.error('[TurnRuntimeStore] Failed to persist store:', error)
      throw error
    }
  }

  private now(): number {
    return Date.now()
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  private findRuntimeIndex(taskId: string): number {
    return this.data.runtimes.findIndex((item) => item.taskId === taskId)
  }

  private getOrCreateRuntime(taskId: string): TaskRuntimeRecord {
    const index = this.findRuntimeIndex(taskId)
    if (index >= 0) {
      return this.data.runtimes[index]
    }

    const created: TaskRuntimeRecord = {
      taskId,
      version: 0,
      status: 'idle',
      activeTurnId: null,
      updatedAt: this.now(),
    }
    this.data.runtimes.push(created)
    return created
  }

  private findTurnIndex(turnId: string): number {
    return this.data.turns.findIndex((item) => item.id === turnId)
  }

  private isTerminalState(state: TurnState): boolean {
    return TERMINAL_STATES.includes(state)
  }

  private areDependenciesResolved(turn: TurnRecord): boolean {
    if (turn.blockedByTurnIds.length === 0) return true
    return turn.blockedByTurnIds.every((dependencyId) => {
      const dependency = this.data.turns.find((item) => item.id === dependencyId && item.taskId === turn.taskId)
      return !!dependency && this.isTerminalState(dependency.state)
    })
  }

  private inferImplicitDependencies(taskId: string, exceptTurnId?: string): string[] {
    const blockingTurns = this.data.turns
      .filter((item) =>
        item.taskId === taskId &&
        item.id !== exceptTurnId &&
        BLOCKING_STATES.includes(item.state)
      )
      .sort((a, b) => a.createdAt - b.createdAt)
    if (blockingTurns.length === 0) return []
    return [blockingTurns[blockingTurns.length - 1].id]
  }

  private refreshRuntimeStatus(taskId: string): void {
    const runtime = this.getOrCreateRuntime(taskId)
    const turns = this.data.turns.filter((item) => item.taskId === taskId)
    const activeTurn = runtime.activeTurnId
      ? turns.find((item) => item.id === runtime.activeTurnId)
      : null

    if (activeTurn && ['planning', 'executing'].includes(activeTurn.state)) {
      runtime.status = 'running'
    } else if (turns.some((item) => ['awaiting_approval', 'awaiting_clarification'].includes(item.state))) {
      runtime.status = 'awaiting'
      runtime.activeTurnId = null
    } else if (turns.some((item) => item.state === 'blocked')) {
      runtime.status = 'blocked'
      runtime.activeTurnId = null
    } else if (turns.some((item) => item.state === 'failed')) {
      runtime.status = 'error'
      runtime.activeTurnId = null
    } else {
      runtime.status = 'idle'
      runtime.activeTurnId = null
    }
    runtime.updatedAt = this.now()
  }

  private unblockResolvedTurns(taskId: string): boolean {
    const now = this.now()
    let changed = false
    for (const turn of this.data.turns) {
      if (turn.taskId !== taskId || turn.state !== 'blocked') continue
      if (!this.areDependenciesResolved(turn)) continue
      turn.state = 'queued'
      turn.blockedByTurnIds = []
      turn.reason = null
      turn.updatedAt = now
      changed = true
    }
    return changed
  }

  createTurn(input: CreateTurnInput): CreateTurnResult {
    const runtime = this.getOrCreateRuntime(input.taskId)
    const now = this.now()
    const readVersion = typeof input.readVersion === 'number' && Number.isFinite(input.readVersion)
      ? Math.max(0, Math.floor(input.readVersion))
      : runtime.version

    if (input.turnId) {
      const existingIndex = this.findTurnIndex(input.turnId)
      if (existingIndex >= 0) {
        const existing = this.data.turns[existingIndex]
        if (existing.taskId !== input.taskId) {
          throw new Error(`Turn ${input.turnId} does not belong to task ${input.taskId}`)
        }
        existing.prompt = input.prompt || existing.prompt
        existing.runId = input.runId || existing.runId
        existing.updatedAt = now
        if (existing.state === 'blocked' && this.areDependenciesResolved(existing)) {
          existing.state = 'queued'
          existing.blockedByTurnIds = []
          existing.reason = null
        }
        this.refreshRuntimeStatus(input.taskId)
        this.persist()
        return {
          created: false,
          turn: clone(existing),
          runtime: clone(this.getOrCreateRuntime(input.taskId)),
        }
      }
    }

    const explicitDependencies = Array.isArray(input.dependsOnTurnIds)
      ? input.dependsOnTurnIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    const inferredDependencies = explicitDependencies.length > 0
      ? explicitDependencies
      : this.inferImplicitDependencies(input.taskId)
    const uniqueDependencies = Array.from(new Set(inferredDependencies))
    const unresolvedDependencies = uniqueDependencies.filter((dependencyId) => {
      const dependency = this.data.turns.find((item) => item.id === dependencyId && item.taskId === input.taskId)
      return !dependency || !this.isTerminalState(dependency.state)
    })

    const nextTurn: TurnRecord = {
      id: input.turnId || this.generateId('turn'),
      taskId: input.taskId,
      runId: input.runId || null,
      prompt: input.prompt,
      state: unresolvedDependencies.length > 0 ? 'blocked' : 'queued',
      readVersion,
      writeVersion: null,
      blockedByTurnIds: unresolvedDependencies,
      reason: unresolvedDependencies.length > 0
        ? `Waiting for dependent turns: ${unresolvedDependencies.join(', ')}`
        : null,
      createdAt: now,
      updatedAt: now,
    }
    this.data.turns.push(nextTurn)
    this.refreshRuntimeStatus(input.taskId)
    this.persist()
    return {
      created: true,
      turn: clone(nextTurn),
      runtime: clone(this.getOrCreateRuntime(input.taskId)),
    }
  }

  markTurnPlanning(turnId: string): TurnTransitionResult {
    const index = this.findTurnIndex(turnId)
    if (index < 0) {
      return { status: 'not_found', turn: null, runtime: null }
    }
    const turn = this.data.turns[index]
    if (!['queued', 'planning', 'awaiting_clarification'].includes(turn.state)) {
      return {
        status: 'conflict',
        turn: clone(turn),
        runtime: clone(this.getOrCreateRuntime(turn.taskId)),
        reason: `Turn state "${turn.state}" cannot enter planning.`,
      }
    }
    if (turn.state !== 'planning' && !this.areDependenciesResolved(turn)) {
      turn.state = 'blocked'
      turn.reason = `Waiting for dependent turns: ${turn.blockedByTurnIds.join(', ')}`
      turn.updatedAt = this.now()
      this.refreshRuntimeStatus(turn.taskId)
      this.persist()
      return {
        status: 'blocked',
        turn: clone(turn),
        runtime: clone(this.getOrCreateRuntime(turn.taskId)),
        reason: turn.reason || undefined,
      }
    }
    turn.state = 'planning'
    turn.reason = null
    turn.updatedAt = this.now()
    const runtime = this.getOrCreateRuntime(turn.taskId)
    runtime.activeTurnId = turn.id
    runtime.status = 'running'
    runtime.updatedAt = this.now()
    this.persist()
    return { status: 'ok', turn: clone(turn), runtime: clone(runtime) }
  }

  markTurnAwaitingApproval(turnId: string): TurnTransitionResult {
    return this.updateTurnState(turnId, 'awaiting_approval')
  }

  markTurnAwaitingClarification(turnId: string): TurnTransitionResult {
    return this.updateTurnState(turnId, 'awaiting_clarification')
  }

  private updateTurnState(turnId: string, nextState: TurnState): TurnTransitionResult {
    const index = this.findTurnIndex(turnId)
    if (index < 0) {
      return { status: 'not_found', turn: null, runtime: null }
    }
    const turn = this.data.turns[index]
    turn.state = nextState
    turn.reason = null
    turn.updatedAt = this.now()
    this.refreshRuntimeStatus(turn.taskId)
    this.persist()
    return {
      status: 'ok',
      turn: clone(turn),
      runtime: clone(this.getOrCreateRuntime(turn.taskId)),
    }
  }

  startExecution(turnId: string, expectedTaskVersion?: number): ExecutionStartResult {
    const index = this.findTurnIndex(turnId)
    if (index < 0) {
      return {
        status: 'not_found',
        code: 'TURN_NOT_FOUND',
        turn: null,
        runtime: null,
      }
    }

    const turn = this.data.turns[index]
    if (!['awaiting_approval', 'executing'].includes(turn.state)) {
      return {
        status: 'conflict',
        code: 'TURN_STATE_CONFLICT',
        turn: clone(turn),
        runtime: clone(this.getOrCreateRuntime(turn.taskId)),
        reason: `Turn state "${turn.state}" cannot enter execution.`,
      }
    }

    if (!this.areDependenciesResolved(turn)) {
      turn.state = 'blocked'
      turn.reason = `Waiting for dependent turns: ${turn.blockedByTurnIds.join(', ')}`
      turn.updatedAt = this.now()
      this.refreshRuntimeStatus(turn.taskId)
      this.persist()
      return {
        status: 'blocked',
        code: 'TURN_BLOCKED',
        turn: clone(turn),
        runtime: clone(this.getOrCreateRuntime(turn.taskId)),
        reason: turn.reason || undefined,
      }
    }

    const runtime = this.getOrCreateRuntime(turn.taskId)
    const expected = typeof expectedTaskVersion === 'number' && Number.isFinite(expectedTaskVersion)
      ? Math.max(0, Math.floor(expectedTaskVersion))
      : turn.readVersion
    if (runtime.version !== expected) {
      return {
        status: 'conflict',
        code: 'TURN_VERSION_CONFLICT',
        turn: clone(turn),
        runtime: clone(runtime),
        reason: `Task version mismatch: expected ${expected}, actual ${runtime.version}.`,
      }
    }

    turn.state = 'executing'
    turn.reason = null
    turn.updatedAt = this.now()
    runtime.activeTurnId = turn.id
    runtime.status = 'running'
    runtime.updatedAt = this.now()
    this.persist()
    return {
      status: 'ok',
      turn: clone(turn),
      runtime: clone(runtime),
    }
  }

  completeTurn(turnId: string, artifactContent?: string): TurnTransitionResult {
    const index = this.findTurnIndex(turnId)
    if (index < 0) {
      return { status: 'not_found', turn: null, runtime: null }
    }
    const turn = this.data.turns[index]
    if (this.isTerminalState(turn.state)) {
      return {
        status: 'conflict',
        turn: clone(turn),
        runtime: clone(this.getOrCreateRuntime(turn.taskId)),
        reason: `Turn is already terminal (${turn.state}).`,
      }
    }

    const runtime = this.getOrCreateRuntime(turn.taskId)
    runtime.version += 1
    runtime.updatedAt = this.now()

    turn.state = 'completed'
    turn.writeVersion = runtime.version
    turn.reason = null
    turn.updatedAt = this.now()

    if (artifactContent && artifactContent.trim()) {
      this.data.artifacts.push({
        id: this.generateId('artifact'),
        taskId: turn.taskId,
        turnId: turn.id,
        type: 'output',
        content: artifactContent.trim(),
        createdAt: this.now(),
      })
    }

    this.unblockResolvedTurns(turn.taskId)
    this.refreshRuntimeStatus(turn.taskId)
    this.persist()
    return {
      status: 'ok',
      turn: clone(turn),
      runtime: clone(this.getOrCreateRuntime(turn.taskId)),
    }
  }

  failTurn(turnId: string, reason?: string): TurnTransitionResult {
    return this.finishTurn(turnId, 'failed', reason)
  }

  cancelTurn(turnId: string, reason?: string): TurnTransitionResult {
    return this.finishTurn(turnId, 'cancelled', reason)
  }

  private finishTurn(turnId: string, finalState: 'failed' | 'cancelled', reason?: string): TurnTransitionResult {
    const index = this.findTurnIndex(turnId)
    if (index < 0) {
      return { status: 'not_found', turn: null, runtime: null }
    }
    const turn = this.data.turns[index]
    if (this.isTerminalState(turn.state)) {
      return {
        status: 'conflict',
        turn: clone(turn),
        runtime: clone(this.getOrCreateRuntime(turn.taskId)),
        reason: `Turn is already terminal (${turn.state}).`,
      }
    }

    turn.state = finalState
    turn.reason = reason || null
    turn.updatedAt = this.now()
    this.unblockResolvedTurns(turn.taskId)
    this.refreshRuntimeStatus(turn.taskId)
    this.persist()
    return {
      status: 'ok',
      turn: clone(turn),
      runtime: clone(this.getOrCreateRuntime(turn.taskId)),
    }
  }

  getRuntime(taskId: string): TaskRuntimeRecord | null {
    const runtime = this.data.runtimes.find((item) => item.taskId === taskId)
    return runtime ? clone(runtime) : null
  }

  getTurn(turnId: string): TurnRecord | null {
    const turn = this.data.turns.find((item) => item.id === turnId)
    return turn ? clone(turn) : null
  }

  listTurns(taskId: string): TurnRecord[] {
    return this.data.turns
      .filter((item) => item.taskId === taskId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => clone(item))
  }

  listArtifacts(taskId: string): TurnArtifactRecord[] {
    return this.data.artifacts
      .filter((item) => item.taskId === taskId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => clone(item))
  }

  findLatestTurnByTask(taskId: string, states?: TurnState[]): TurnRecord | null {
    const turns = this.data.turns
      .filter((item) => item.taskId === taskId && (!states || states.includes(item.state)))
      .sort((a, b) => b.createdAt - a.createdAt)
    return turns[0] ? clone(turns[0]) : null
  }

  findLatestTurnByRun(runId: string, states?: TurnState[]): TurnRecord | null {
    const turns = this.data.turns
      .filter((item) =>
        item.runId === runId &&
        (!states || states.includes(item.state))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return turns[0] ? clone(turns[0]) : null
  }

  findLatestTurnBySession(sessionId: string, states?: TurnState[]): TurnRecord | null {
    return this.findLatestTurnByRun(sessionId, states)
  }

  getTurnByPlanBinding(taskId: string): TurnRecord | null {
    const turns = this.data.turns
      .filter((item) =>
        item.taskId === taskId &&
        ['awaiting_approval', 'executing'].includes(item.state)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return turns[0] ? clone(turns[0]) : null
  }

  sweepOnStartup(): { resetRuntimeCount: number; interruptedTurnCount: number } {
    const now = this.now()
    let resetRuntimeCount = 0
    let interruptedTurnCount = 0
    let unblockedTaskCount = 0
    const taskIds = new Set<string>()

    for (const runtime of this.data.runtimes) {
      taskIds.add(runtime.taskId)
      if (runtime.status !== 'idle' || runtime.activeTurnId) {
        runtime.status = 'idle'
        runtime.activeTurnId = null
        runtime.updatedAt = now
        resetRuntimeCount += 1
      }
    }

    for (const turn of this.data.turns) {
      taskIds.add(turn.taskId)
      if (['awaiting_approval', 'awaiting_clarification'].includes(turn.state)) {
        const previousState = turn.state
        turn.state = 'cancelled'
        turn.reason = previousState === 'awaiting_approval'
          ? 'API process restarted before approval was resolved.'
          : 'API process restarted before clarification was resolved.'
        turn.updatedAt = now
        interruptedTurnCount += 1
        continue
      }
      if (['planning', 'executing'].includes(turn.state)) {
        turn.state = 'failed'
        turn.reason = turn.reason || 'API process restarted before turn completed.'
        turn.updatedAt = now
        interruptedTurnCount += 1
      }
    }

    for (const taskId of taskIds) {
      if (this.unblockResolvedTurns(taskId)) {
        unblockedTaskCount += 1
      }
      this.refreshRuntimeStatus(taskId)
    }

    if (resetRuntimeCount > 0 || interruptedTurnCount > 0 || unblockedTaskCount > 0) {
      this.persist()
    }

    return {
      resetRuntimeCount,
      interruptedTurnCount,
    }
  }
}

export const turnRuntimeStore = new TurnRuntimeStore()
