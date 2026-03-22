import { describe, expect, it, vi } from 'vitest'
import type { ApprovalCoordinatorResolveResult } from '../../types/approval'
import { resolvePermissionResponse, resolveQuestionResponse } from '../approval-response'

describe('approval-response', () => {
  it('builds permission response with runtime turn lookup and auto-allow metadata', () => {
    const turn = { id: 'turn_permission_response' }
    const findLatestTurnByTask = vi.fn(() => turn)

    const result = resolvePermissionResponse({
      resolution: {
        status: 'resolved',
        attachedToRuntime: true,
        record: {
          id: 'permission_1',
          kind: 'permission',
          status: 'approved',
          runId: 'run_1',
          taskId: 'task_permission_response',
          providerSessionId: 'run_1',
          permission: null,
          question: null,
          source: null,
          round: null,
          approved: true,
          answers: null,
          reason: null,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: null,
          resolvedAt: 1,
        },
      } satisfies ApprovalCoordinatorResolveResult,
      approved: true,
      autoAllowUpdated: true,
      autoAllowToolName: 'Bash',
      findLatestTurnByTask,
    })

    expect(findLatestTurnByTask).toHaveBeenCalledWith('task_permission_response', [
      'executing',
      'awaiting_approval',
      'awaiting_clarification',
      'planning',
      'blocked',
    ])
    expect(result).toEqual({
      success: true,
      approved: true,
      status: 'resolved',
      attachedToRuntime: true,
      turnId: 'turn_permission_response',
      autoAllowUpdated: true,
      autoAllowToolName: 'Bash',
    })
  })

  it('falls back to terminal turn lookup when permission response has no active runtime turn', () => {
    const findLatestTurnByTask = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ id: 'turn_permission_cancelled' })

    const result = resolvePermissionResponse({
      resolution: {
        status: 'resolved',
        attachedToRuntime: false,
        record: {
          id: 'permission_terminal',
          kind: 'permission',
          status: 'canceled',
          runId: 'run_terminal',
          taskId: 'task_permission_response',
          providerSessionId: 'run_terminal',
          permission: null,
          question: null,
          source: null,
          round: null,
          approved: false,
          answers: null,
          reason: 'Session stopped by user.',
          createdAt: 1,
          updatedAt: 2,
          expiresAt: null,
          resolvedAt: 2,
        },
      } satisfies ApprovalCoordinatorResolveResult,
      approved: false,
      autoAllowUpdated: false,
      autoAllowToolName: null,
      findLatestTurnByTask,
    })

    expect(findLatestTurnByTask).toHaveBeenNthCalledWith(1, 'task_permission_response', [
      'executing',
      'awaiting_approval',
      'awaiting_clarification',
      'planning',
      'blocked',
    ])
    expect(findLatestTurnByTask).toHaveBeenNthCalledWith(2, 'task_permission_response', [
      'cancelled',
      'failed',
      'completed',
    ])
    expect(result.turnId).toBe('turn_permission_cancelled')
  })

  it('builds question response with resume_planning nextAction for clarification source', () => {
    const findLatestTurnByTask = vi.fn(() => ({ id: 'turn_question_response' }))

    const result = resolveQuestionResponse({
      resolution: {
        status: 'resolved',
        attachedToRuntime: false,
        record: {
          id: 'question_1',
          kind: 'question',
          status: 'approved',
          runId: 'run_1',
          taskId: 'task_question_response',
          providerSessionId: 'run_1',
          permission: null,
          question: null,
          source: 'clarification',
          round: 1,
          approved: null,
          answers: { selected: 'A' },
          reason: null,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: null,
          resolvedAt: 1,
        },
      } satisfies ApprovalCoordinatorResolveResult,
      answers: { selected: 'A' },
      findLatestTurnByTask,
    })

    expect(findLatestTurnByTask).toHaveBeenCalledWith('task_question_response', [
      'awaiting_clarification',
      'planning',
      'blocked',
      'queued',
      'executing',
    ])
    expect(result).toEqual({
      success: true,
      answers: { selected: 'A' },
      status: 'resolved',
      attachedToRuntime: false,
      canResume: true,
      nextAction: 'resume_planning',
      turnId: 'turn_question_response',
    })
  })

  it('falls back to terminal turn lookup for question response when no active turn remains', () => {
    const findLatestTurnByTask = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ id: 'turn_question_cancelled' })

    const result = resolveQuestionResponse({
      resolution: {
        status: 'resolved',
        attachedToRuntime: false,
        record: {
          id: 'question_terminal',
          kind: 'question',
          status: 'canceled',
          runId: 'run_terminal',
          taskId: 'task_question_response',
          providerSessionId: 'run_terminal',
          permission: null,
          question: null,
          source: 'clarification',
          round: 1,
          approved: null,
          answers: { selected: 'A' },
          reason: 'Plan expired before execution.',
          createdAt: 1,
          updatedAt: 2,
          expiresAt: null,
          resolvedAt: 2,
        },
      } satisfies ApprovalCoordinatorResolveResult,
      answers: { selected: 'A' },
      findLatestTurnByTask,
    })

    expect(findLatestTurnByTask).toHaveBeenNthCalledWith(1, 'task_question_response', [
      'awaiting_clarification',
      'planning',
      'blocked',
      'queued',
      'executing',
    ])
    expect(findLatestTurnByTask).toHaveBeenNthCalledWith(2, 'task_question_response', [
      'cancelled',
      'failed',
      'completed',
    ])
    expect(result.canResume).toBe(false)
    expect(result.nextAction).toBeNull()
    expect(result.turnId).toBe('turn_question_cancelled')
  })

  it('defaults question response to resume_execution and null turn when no task binding exists', () => {
    const findLatestTurnByTask = vi.fn()

    const result = resolveQuestionResponse({
      resolution: {
        status: 'already_resolved',
        attachedToRuntime: true,
        record: {
          id: 'question_2',
          kind: 'question',
          status: 'approved',
          runId: 'run_2',
          taskId: null,
          providerSessionId: 'run_2',
          permission: null,
          question: null,
          source: 'runtime_tool_question',
          round: null,
          approved: null,
          answers: { selected: 'continue' },
          reason: null,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: null,
          resolvedAt: 1,
        },
      } satisfies ApprovalCoordinatorResolveResult,
      answers: { selected: 'continue' },
      findLatestTurnByTask,
    })

    expect(findLatestTurnByTask).not.toHaveBeenCalled()
    expect(result.canResume).toBe(false)
    expect(result.nextAction).toBeNull()
    expect(result.turnId).toBeNull()
  })
})
