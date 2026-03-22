import { describe, expect, it } from 'vitest'
import type { ApprovalRequestRecord } from '../../types/approval'
import { buildApprovalDiagnosticsResponse, buildPendingApprovalsResponse, normalizeApprovalDiagnosticsLimit } from '../approval-recovery'

function createRecord(overrides: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
  return {
    id: 'approval_record',
    kind: 'question',
    status: 'pending',
    runId: 'run_approval',
    taskId: 'task_approval',
    providerSessionId: 'run_approval',
    permission: null,
    question: {
      id: 'question_approval',
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

describe('approval-recovery', () => {
  it('builds pending approval payload with permission/question projection and latest terminal passthrough', () => {
    const pendingPermission = createRecord({
      id: 'permission_1',
      kind: 'permission',
      permission: {
        id: 'permission_1',
        toolName: 'Bash',
        command: 'pwd',
        reason: '需要访问工作目录',
      },
      question: null,
      source: null,
      round: null,
    })
    const pendingQuestion = createRecord()
    const latestTerminal = createRecord({
      id: 'question_terminal',
      status: 'approved',
      resolvedAt: 2,
    })

    const result = buildPendingApprovalsResponse({
      pendingItems: [pendingPermission, pendingQuestion],
      latestTerminal,
    })

    expect(result.pendingCount).toBe(2)
    expect(result.pendingPermissions.map((item) => item.id)).toEqual(['permission_1'])
    expect(result.pendingQuestions).toEqual([
      {
        id: 'question_approval',
        question: '请选择输出格式',
        options: ['Markdown', 'JSON'],
        allowFreeText: true,
        source: 'clarification',
        round: 2,
      },
    ])
    expect(result.latestTerminal).toBe(latestTerminal)
  })

  it('normalizes diagnostics limit into bounded positive integers', () => {
    expect(normalizeApprovalDiagnosticsLimit(undefined)).toBe(20)
    expect(normalizeApprovalDiagnosticsLimit('0')).toBe(20)
    expect(normalizeApprovalDiagnosticsLimit('-5')).toBe(20)
    expect(normalizeApprovalDiagnosticsLimit('40')).toBe(40)
    expect(normalizeApprovalDiagnosticsLimit('999')).toBe(200)
    expect(normalizeApprovalDiagnosticsLimit('oops')).toBe(20)
  })

  it('builds diagnostics response with null-safe scope echo', () => {
    const pending = [createRecord()]
    const terminal = [createRecord({ status: 'approved', resolvedAt: 2 })]

    const result = buildApprovalDiagnosticsResponse({
      taskId: undefined,
      runId: 'run_approval',
      kind: undefined,
      limit: 40,
      diagnostics: {
        scopedCount: 2,
        countsByStatus: {
          pending: 1,
          approved: 1,
          rejected: 0,
          expired: 0,
          canceled: 0,
          orphaned: 0,
        },
        countsByKind: {
          permission: 0,
          question: 2,
        },
        pending,
        terminal,
      },
    })

    expect(result).toEqual({
      scopedCount: 2,
      countsByStatus: {
        pending: 1,
        approved: 1,
        rejected: 0,
        expired: 0,
        canceled: 0,
        orphaned: 0,
      },
      countsByKind: {
        permission: 0,
        question: 2,
      },
      pending,
      terminal,
      taskId: null,
      runId: 'run_approval',
      kind: null,
      limit: 40,
    })
  })
})
