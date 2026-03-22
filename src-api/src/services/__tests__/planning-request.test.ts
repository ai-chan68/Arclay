import { describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../agent-run-store'
import type { ConversationMessage } from '../../core/agent/interface'
import type { TurnRecord } from '../../types/turn-runtime'
import { preparePlanningRequest } from '../planning-request'

function createRun(id = 'run_planning_request'): AgentRun {
  return {
    id,
    phase: 'plan',
    createdAt: new Date('2026-03-22T15:30:00.000Z'),
    isAborted: false,
    abortController: new AbortController(),
  }
}

function createTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: 'turn_planning_request',
    taskId: 'task_planning_request',
    runId: 'run_planning_request',
    prompt: 'Plan this',
    state: 'queued',
    readVersion: 0,
    writeVersion: null,
    blockedByTurnIds: [],
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('preparePlanningRequest', () => {
  it('rejects missing prompt before creating a run', () => {
    const createRunSpy = vi.fn()

    const result = preparePlanningRequest({
      body: {},
      createRun: createRunSpy,
      createTurn: vi.fn(),
    })

    expect(result).toEqual({
      status: 'validation_error',
      statusCode: 400,
      body: {
        error: 'prompt is required',
      },
    })
    expect(createRunSpy).not.toHaveBeenCalled()
  })

  it('creates a fresh planning run and normalizes request fields', () => {
    const createTurnSpy = vi.fn(() => ({
      turn: createTurn(),
      runtime: null,
      status: 'ok',
    }))
    const conversation: ConversationMessage[] = [
      { role: 'user', content: '写一个 flappy bird 游戏' },
      { role: 'assistant', content: '已创建文件：/tmp/sessions/task/index.html' },
    ]

    const result = preparePlanningRequest({
      body: {
        prompt: '继续优化游戏',
        taskId: '  task_planning_request  ',
        clarificationAnswers: {
          format: ' markdown ',
          empty: '   ',
        },
        maxClarificationRounds: 99,
        sessionId: 'client_session_should_be_ignored',
        turnId: '  turn_planning_request  ',
        readVersion: 4.9,
        dependsOnTurnIds: [' turn_prev_1 ', '', 3, 'turn_prev_2'],
        conversation: [
          { role: 'user', content: '写一个 flappy bird 游戏' },
          { role: 'assistant', content: '已创建文件：/tmp/sessions/task/index.html' },
          { role: 'assistant', content: '   ' },
          { role: 'hacker', content: 'ignore me' },
        ],
      },
      createRun: vi.fn(() => createRun()),
      createTurn: createTurnSpy,
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {
      throw new Error('expected ready result')
    }
    expect(result.run.id).toBe('run_planning_request')
    expect(result.planningPrompt).toBe('继续优化游戏\n\n[Clarification Answers]\nformat: markdown')
    expect(result.rawPrompt).toBe('继续优化游戏')
    expect(result.taskId).toBe('task_planning_request')
    expect(result.maxClarificationRounds).toBe(10)
    expect(result.conversation).toEqual(conversation)
    expect(result.activeTurn?.id).toBe('turn_planning_request')
    expect(createTurnSpy).toHaveBeenCalledWith({
      taskId: 'task_planning_request',
      prompt: '继续优化游戏\n\n[Clarification Answers]\nformat: markdown',
      runId: 'run_planning_request',
      turnId: 'turn_planning_request',
      readVersion: 4,
      dependsOnTurnIds: ['turn_prev_1', 'turn_prev_2'],
    })
  })

  it('does not create a turn when no taskId is provided and clamps invalid clarification rounds', () => {
    const createTurnSpy = vi.fn()

    const result = preparePlanningRequest({
      body: {
        prompt: 'Analyze this repository',
        maxClarificationRounds: -3,
      },
      createRun: vi.fn(() => createRun('run_no_turn')),
      createTurn: createTurnSpy,
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {
      throw new Error('expected ready result')
    }
    expect(result.run.id).toBe('run_no_turn')
    expect(result.taskId).toBeUndefined()
    expect(result.activeTurn).toBeNull()
    expect(result.maxClarificationRounds).toBe(3)
    expect(createTurnSpy).not.toHaveBeenCalled()
  })
})
