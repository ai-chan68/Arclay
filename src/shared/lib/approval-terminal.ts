import type { AgentMessage } from '@shared-types'

export interface ApprovalTerminalLike {
  id: string
  kind: 'permission' | 'question'
  status: 'approved' | 'rejected' | 'expired' | 'canceled' | 'orphaned'
  reason: string | null
  updatedAt: number
}

export function buildApprovalTerminalMessage(terminal: ApprovalTerminalLike): AgentMessage {
  const defaultReason =
    terminal.status === 'orphaned'
      ? '审批请求对应的执行会话已失效，请重新发起任务。'
      : terminal.status === 'expired'
        ? '审批超时，请重新执行任务后再次审批。'
        : terminal.status === 'canceled'
          ? '审批请求已取消，若仍需执行请重新发起。'
          : terminal.status === 'rejected'
            ? '审批已被拒绝，如仍需继续请重新发起任务。'
            : '审批请求已结束。'

  const statusLabel =
    terminal.status === 'rejected'
      ? '已拒绝'
      : terminal.status === 'expired'
        ? '已超时'
        : terminal.status === 'canceled'
          ? '已取消'
          : terminal.status === 'orphaned'
            ? '会话已失效'
            : '已批准'

  return {
    id: `approval_terminal_${terminal.id}`,
    type: 'text',
    role: 'assistant',
    content: `审批状态: ${statusLabel}。${terminal.reason || defaultReason}`,
    timestamp: terminal.updatedAt,
    metadata: {
      approvalTerminalId: terminal.id,
      approvalTerminalKind: terminal.kind,
      approvalTerminalStatus: terminal.status,
    },
  }
}

export function hasApprovalTerminalMessage(
  messages: AgentMessage[],
  terminalId: string
): boolean {
  return messages.some((message) => (
    message.metadata?.approvalTerminalId === terminalId
  ))
}
