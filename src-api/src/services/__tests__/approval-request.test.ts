import { describe, expect, it, vi } from 'vitest'
import type { ApprovalCoordinatorResolveResult, ApprovalRequestRecord } from '../../types/approval'
import { resolveApprovalDiagnosticsRequest, resolvePendingApprovalsRequest, resolvePermissionRequest, resolveQuestionRequest } from '../approval-request'

function createRecord(overrides: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
  return {
    id: 'approval_record',
    kind: 'question',
    status: 'pending',
    runId: 'run_approval_request',
    taskId: 'task_approval_request',
    providerSessionId: 'run_approval_request',
    permission: null,
    question: {
      id: 'question_approval_request',
      question: '请选择输出格式',
      options: ['Markdown', 'JSON'],
      allowFreeText: true,
    },
    source: 'clarification',
    round: 2,
    approved: null,
    answers: null,
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    expiresAt: null,
    resolvedAt: null,
    ...overrides,
  }
}

function createResolution(overrides: Partial<ApprovalCoordinatorResolveResult> = {}): ApprovalCoordinatorResolveResult {
  return {
    status: 'resolved',
    attachedToRuntime: true,
    record: createRecord({
      id: 'permission_approval_request',
      kind: 'permission',
      permission: {
        id: 'permission_approval_request',
        toolName: 'Bash',
        command: 'pwd',
        reason: '需要读取当前目录',
      },
      question: null,
      source: null,
      round: null,
      approved: true,
      answers: null,
      resolvedAt: 2,
    }),
    ...overrides,
  }
}

describe('approval-request', () => {
  it('builds pending approvals response using sessionId alias for run scope', () => {
    const listPending = vi.fn(() => [createRecord()])
    const getLatestTerminal = vi.fn(() => createRecord({
      id: 'terminal_approval_request',
      status: 'approved',
      resolvedAt: 3,
    }))

    const result = resolvePendingApprovalsRequest({
      taskId: undefined,
      runId: undefined,
      sessionId: 'run_from_session_alias',
      kind: 'question',
      listPending,
      getLatestTerminal,
    })

    expect(listPending).toHaveBeenCalledWith({
      taskId: undefined,
      runId: 'run_from_session_alias',
      kind: 'question',
    })
    expect(getLatestTerminal).toHaveBeenCalledWith({
      taskId: undefined,
      runId: 'run_from_session_alias',
      kind: 'question',
    })
    expect(result.pendingCount).toBe(1)
    expect(result.pendingQuestions[0]?.source).toBe('clarification')
    expect(result.latestTerminal?.id).toBe('terminal_approval_request')
  })

  it('builds diagnostics response with normalized sessionId scope and bounded limit', () => {
    const getDiagnostics = vi.fn(() => ({
      scopedCount: 1,
      countsByStatus: {
        pending: 1,
        approved: 0,
        rejected: 0,
        expired: 0,
        canceled: 0,
        orphaned: 0,
      },
      countsByKind: {
        permission: 0,
        question: 1,
      },
      pending: [createRecord()],
      terminal: [],
    }))

    const result = resolveApprovalDiagnosticsRequest({
      taskId: undefined,
      runId: undefined,
      sessionId: 'run_diag_alias',
      kind: undefined,
      limit: '999',
      getDiagnostics,
    })

    expect(getDiagnostics).toHaveBeenCalledWith({
      taskId: undefined,
      runId: 'run_diag_alias',
      kind: undefined,
    }, 200)
    expect(result.runId).toBe('run_diag_alias')
    expect(result.limit).toBe(200)
  })

  it('validates permission request body before resolving', () => {
    const resolvePermission = vi.fn()

    const result = resolvePermissionRequest({
      body: {
        permissionId: 'permission_approval_request',
        approved: 'yes',
      },
      resolvePermission,
      addToolToAutoAllowList: vi.fn(),
      findLatestTurnByTask: vi.fn(),
    })

    expect(result).toEqual({
      statusCode: 400,
      body: {
        error: 'approved must be boolean',
      },
    })
    expect(resolvePermission).not.toHaveBeenCalled()
  })

  it('resolves permission request and applies auto-allow for approved tool metadata', () => {
    const resolvePermission = vi.fn(() => createResolution({
      record: createRecord({
        id: 'permission_approval_request',
        kind: 'permission',
        permission: {
          id: 'permission_approval_request',
          toolName: 'Bash',
          command: 'pwd',
          reason: '需要读取当前目录',
          metadata: {
            toolName: 'Bash',
          },
        } as any,
        question: null,
        source: null,
        round: null,
        approved: true,
        resolvedAt: 2,
      }),
    }))
    const addToolToAutoAllowList = vi.fn(() => ({
      updated: true,
      tools: ['Bash'],
    }))
    const findLatestTurnByTask = vi.fn(() => ({ id: 'turn_approval_request' }))

    const result = resolvePermissionRequest({
      body: {
        permissionId: 'permission_approval_request',
        approved: true,
        addToAutoAllow: true,
      },
      resolvePermission,
      addToolToAutoAllowList,
      findLatestTurnByTask,
    })

    expect(resolvePermission).toHaveBeenCalledWith('permission_approval_request', true, undefined)
    expect(addToolToAutoAllowList).toHaveBeenCalledWith('Bash')
    expect(result).toEqual({
      statusCode: 200,
      body: {
        success: true,
        approved: true,
        status: 'resolved',
        attachedToRuntime: true,
        turnId: 'turn_approval_request',
        autoAllowUpdated: true,
        autoAllowToolName: 'Bash',
      },
    })
  })

  it('maps missing question request to 404', () => {
    const result = resolveQuestionRequest({
      body: {
        questionId: 'missing_question',
        answers: {
          selected: 'A',
        },
      },
      resolveQuestion: vi.fn(() => ({
        status: 'not_found',
        attachedToRuntime: false,
        record: null,
      })),
      findLatestTurnByTask: vi.fn(),
    })

    expect(result).toEqual({
      statusCode: 404,
      body: {
        error: 'Question not found',
      },
    })
  })

  it('builds successful question response with resume_planning nextAction', () => {
    const resolveQuestion = vi.fn(() => ({
      status: 'resolved',
      attachedToRuntime: true,
      record: createRecord({
        id: 'question_approval_request',
        kind: 'question',
        source: 'clarification',
        answers: {
          selected: 'Markdown',
        },
        approved: null,
        resolvedAt: 2,
      }),
    }))
    const findLatestTurnByTask = vi.fn(() => ({ id: 'turn_question_request' }))

    const result = resolveQuestionRequest({
      body: {
        questionId: 'question_approval_request',
        answers: {
          selected: 'Markdown',
        },
      },
      resolveQuestion,
      findLatestTurnByTask,
    })

    expect(result).toEqual({
      statusCode: 200,
      body: {
        success: true,
        answers: {
          selected: 'Markdown',
        },
        status: 'resolved',
        attachedToRuntime: true,
        canResume: true,
        nextAction: 'resume_planning',
        turnId: 'turn_question_request',
      },
    })
  })
})
