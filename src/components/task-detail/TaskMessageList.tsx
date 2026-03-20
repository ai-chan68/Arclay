/**
 * TaskMessageList - 任务消息列表 (easywork Style)
 *
 * 支持特性：
 * - 对话轮次分组 (用户消息 + AI 回复)
 * - 思考过程折叠 (工具调用)
 * - 计划审批显示
 * - 用户问答显示
 * - 文本消息自动合并
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/shared/lib/utils'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Bot,
  Brain,
  Wrench,
  AlertCircle,
  HelpCircle,
  ShieldAlert,
  ListTodo,
  Check,
  X,
  Plus,
  Eye,
  FileText,
} from 'lucide-react'
import type { AgentMessage, TaskPlan, PendingQuestion, PermissionRequest, TaskStatus } from '@shared-types'
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer'
import { extractFilesFromMessages } from '@/shared/lib/file-utils'
import { PlanApproval } from '@/components/task-detail/PlanApproval'
import { buildTurnDisplayModel, getPreferredFailureDetail } from '@/shared/lib'
import {
  isPlaceholderAssistantResponse,
  isProcessAssistantResponse,
  shouldApplyTerminalExecutionFailure,
} from '@/shared/lib/task-state'

type ApprovalTerminalStatus = 'approved' | 'rejected' | 'expired' | 'canceled' | 'orphaned'

interface ApprovalTerminalRecord {
  id: string
  kind: 'permission' | 'question'
  status: ApprovalTerminalStatus
  reason: string | null
  updatedAt: number
}

const INTERRUPTED_APPROVAL_STATUSES: ApprovalTerminalStatus[] = ['rejected', 'expired', 'canceled', 'orphaned']

function isInterruptedByApproval(status?: ApprovalTerminalStatus | null): boolean {
  if (!status) return false
  return INTERRUPTED_APPROVAL_STATUSES.includes(status)
}

function getInterruptedStatusMeta(status?: ApprovalTerminalStatus | null): {
  label: string
  tone: 'warning' | 'danger'
} | null {
  if (!status) return null
  switch (status) {
    case 'rejected':
      return { label: '已拒绝', tone: 'danger' }
    case 'expired':
      return { label: '已过期', tone: 'warning' }
    case 'canceled':
      return { label: '已取消', tone: 'warning' }
    case 'orphaned':
      return { label: '已中断', tone: 'warning' }
    default:
      return null
  }
}

interface TaskMessageListProps {
  messages: AgentMessage[]
  isRunning: boolean
  isLoadingMessages?: boolean
  showInconsistencyWarning?: boolean
  // Execution plan - for showing plan progress during execution
  executionPlan?: TaskPlan | null
  // When awaiting approval, don't show plan in message list (PlanApproval component handles it)
  isAwaitingApproval?: boolean
  isAwaitingClarification?: boolean
  taskStatus?: TaskStatus
  hasPersistedTask?: boolean
  // Question
  latestApprovalTerminal?: ApprovalTerminalRecord | null
  pendingPermission?: PermissionRequest | null
  pendingQuestion?: PendingQuestion | null
  onSubmitPermission?: (permissionId: string, approved: boolean, addToAutoAllow?: boolean) => void
  onSubmitQuestion?: (questionId: string, answers: Record<string, string>) => void
  approvalPlan?: TaskPlan | null
  onApprovePlan?: () => void
  onRejectPlan?: () => void
  canOpenPreview?: boolean
  onOpenPreview?: () => void
  fileBaseDir?: string
  selectedTurnIndex?: number
  onSelectedTurnIndexChange?: (index: number) => void
  onSelectedTurnMessagesChange?: (messages: AgentMessage[], meta: {
    turnsCount: number
    selectedTurnIndex: number
    latestTurnIndex: number
    turnSummary: TurnStatusSummary | null
  }) => void
}

interface ConversationTurn {
  id: string
  userMessage?: AgentMessage
  thinkingMessages: AgentMessage[]
  resultMessage?: AgentMessage
  planMessage?: AgentMessage  // Plan message for this turn
  isComplete: boolean
  plan?: TaskPlan  // Extracted plan for this turn
}

export interface TurnStatusSummary {
  isLatestTurn: boolean
  isRunning: boolean
  isAwaitingApproval: boolean
  isAwaitingClarification: boolean
  isStopped: boolean
  hasPlan: boolean
  hasExecutionTrace: boolean
  hasResultMessage: boolean
  hasError: boolean
  hasInterruptedApproval: boolean
  approvalInterruptedByText: boolean
  interruptedApprovalStatus: 'approved' | 'rejected' | 'expired' | 'canceled' | 'orphaned' | null
}

export function TaskMessageList({
  messages,
  isRunning,
  isLoadingMessages = false,
  showInconsistencyWarning = false,
  executionPlan,
  isAwaitingApproval = false,
  isAwaitingClarification = false,
  taskStatus,
  hasPersistedTask = false,
  latestApprovalTerminal,
  pendingPermission,
  pendingQuestion,
  onSubmitPermission,
  onSubmitQuestion,
  approvalPlan,
  onApprovePlan,
  onRejectPlan,
  canOpenPreview = false,
  onOpenPreview,
  fileBaseDir,
  selectedTurnIndex: controlledSelectedTurnIndex,
  onSelectedTurnIndexChange,
  onSelectedTurnMessagesChange,
}: TaskMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [internalSelectedTurnIndex, setInternalSelectedTurnIndex] = useState(0)
  const [showOlderTurns, setShowOlderTurns] = useState(false)

  // 调试: 打印收到的消息
  useEffect(() => {
    console.log('[TaskMessageList] Messages updated:', messages.map(m => ({
      type: m.type,
      role: m.role,
      toolName: m.toolName,
      content: m.content?.substring(0, 100),
      toolOutput: m.toolOutput?.substring(0, 50)
    })))
  }, [messages])

  // 自动滚动到底部
  useEffect(() => {
    if (isRunning) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isRunning])

  // 处理消息分组
  const turns = groupIntoTurns(messages, isRunning, executionPlan)
  const latestTurnIndex = turns.length - 1
  const selectedTurnIndex = controlledSelectedTurnIndex ?? internalSelectedTurnIndex
  const safeSelectedTurnIndex = turns.length > 0
    ? Math.min(Math.max(selectedTurnIndex, 0), latestTurnIndex)
    : 0

  const updateSelectedTurnIndex = (nextIndex: number) => {
    if (controlledSelectedTurnIndex === undefined) {
      setInternalSelectedTurnIndex(nextIndex)
    }
    onSelectedTurnIndexChange?.(nextIndex)
  }

  useEffect(() => {
    if (turns.length === 0) {
      if (safeSelectedTurnIndex !== 0) {
        updateSelectedTurnIndex(0)
      }
      onSelectedTurnMessagesChange?.([], {
        turnsCount: 0,
        selectedTurnIndex: 0,
        latestTurnIndex: -1,
        turnSummary: null,
      })
      return
    }

    if (safeSelectedTurnIndex !== selectedTurnIndex) {
      updateSelectedTurnIndex(safeSelectedTurnIndex)
      return
    }

    const activeTurn = turns[safeSelectedTurnIndex]
    if (!activeTurn) return
    const selectedTurnMessages = getMessagesForTurn(activeTurn)
    const turnSummary = summarizeTurn({
      turn: activeTurn,
      turnIndex: safeSelectedTurnIndex,
      latestTurnIndex,
      isRunning,
      isAwaitingApproval,
      isAwaitingClarification,
      taskStatus,
      latestApprovalTerminal: safeSelectedTurnIndex === latestTurnIndex ? latestApprovalTerminal : null,
    })
    onSelectedTurnMessagesChange?.(selectedTurnMessages, {
      turnsCount: turns.length,
      selectedTurnIndex: safeSelectedTurnIndex,
      latestTurnIndex,
      turnSummary,
    })
  }, [
    turns,
    safeSelectedTurnIndex,
    selectedTurnIndex,
    latestTurnIndex,
    messages,
    isRunning,
    isAwaitingApproval,
    isAwaitingClarification,
    taskStatus,
    latestApprovalTerminal,
    onSelectedTurnMessagesChange,
    controlledSelectedTurnIndex,
  ])

  const recentTurnStartIndex = Math.max(0, turns.length - 5)
  const isSelectedHistoricalTurn = turns.length > 5 && safeSelectedTurnIndex < recentTurnStartIndex

  useEffect(() => {
    if (isSelectedHistoricalTurn) {
      setShowOlderTurns(true)
    }
  }, [isSelectedHistoricalTurn])

  const activeTurn = turns[safeSelectedTurnIndex]
  const activeTurnMessages = useMemo(
    () => (activeTurn ? getMessagesForTurn(activeTurn) : []),
    [activeTurn]
  )
  const activeTurnArtifacts = useMemo(
    () => extractFilesFromMessages(activeTurnMessages),
    [activeTurnMessages]
  )
  const visibleTimelineStart = showOlderTurns ? 0 : recentTurnStartIndex
  const visibleTurns = turns.slice(visibleTimelineStart)
  const hiddenTurnsCount = visibleTimelineStart

  if (turns.length === 0 && !isRunning && !isLoadingMessages && !pendingPermission && !pendingQuestion) {
    const isMissingHistory = hasPersistedTask && taskStatus !== 'running'
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
          <Bot className="size-6 text-primary" />
        </div>
        <p className="text-sm font-medium">{isMissingHistory ? '未找到历史消息' : '开始对话'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isMissingHistory
            ? '这个历史任务只有任务记录，没有对应的消息内容。新任务创建后将会正常保存消息。'
            : '输入您的问题，AI 将协助您完成任务'}
        </p>
      </div>
    )
  }

  if (isLoadingMessages) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
          <Loader2 className="size-6 text-primary animate-spin" />
        </div>
        <p className="text-sm font-medium">加载消息中...</p>
        <p className="text-xs text-muted-foreground mt-1">
          正在从数据库恢复对话历史
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 状态不一致警告 */}
      {showInconsistencyWarning && (
        <div className="flex items-center gap-3 rounded-lg bg-yellow-50 px-4 py-3 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
          <AlertCircle className="size-4 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">消息同步中</p>
            <p className="text-xs opacity-75">检测到消息状态不完整，正在重新加载...</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] xl:gap-5">
        <aside className="min-w-0">
          <div className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel)_90%,transparent)] p-4 shadow-[0_16px_36px_color-mix(in_oklab,var(--ui-panel)_30%,transparent)] lg:sticky lg:top-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Turn Timeline</p>
                <p className="text-xs text-muted-foreground">按时间查看最近回合</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {turns.length} 条
              </span>
            </div>

            {hiddenTurnsCount > 0 && (
              <button
                onClick={() => setShowOlderTurns((prev) => !prev)}
                className="mb-4 inline-flex items-center gap-1 rounded-full border border-border/50 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-[color:var(--ui-accent)]/40 hover:text-foreground"
              >
                {showOlderTurns ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {showOlderTurns ? '收起更早历史' : `查看更早的 ${hiddenTurnsCount} 条`}
              </button>
            )}

            <div className="space-y-0.5">
              {visibleTurns.map((turn, visibleIndex) => {
                const absoluteIndex = visibleTimelineStart + visibleIndex
                const summary = summarizeTurn({
                  turn,
                  turnIndex: absoluteIndex,
                  latestTurnIndex,
                  isRunning,
                  isAwaitingApproval,
                  isAwaitingClarification,
                  taskStatus,
                  latestApprovalTerminal: absoluteIndex === latestTurnIndex ? latestApprovalTerminal : null,
                })
                return (
                  <TimelineTurnItem
                    key={`turn-nav-${turn.id}`}
                    turn={turn}
                    index={absoluteIndex}
                    isSelected={safeSelectedTurnIndex === absoluteIndex}
                    isLastVisible={visibleIndex === visibleTurns.length - 1}
                    summary={summary}
                    onSelect={() => updateSelectedTurnIndex(absoluteIndex)}
                  />
                )
              })}
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {activeTurn && (
            <SelectedTurnWorkspace
              key={activeTurn.id}
              turn={activeTurn}
              turnIndex={safeSelectedTurnIndex + 1}
              totalTurns={turns.length}
              isRunning={isRunning && safeSelectedTurnIndex === latestTurnIndex}
              isLatestTurn={safeSelectedTurnIndex === latestTurnIndex}
              executionPlan={executionPlan}
              showPlan={!isAwaitingApproval}
              isAwaitingApproval={isAwaitingApproval}
              isAwaitingClarification={isAwaitingClarification}
              taskStatus={taskStatus}
              isStopped={taskStatus === 'stopped'}
              latestApprovalTerminal={safeSelectedTurnIndex === latestTurnIndex ? latestApprovalTerminal : null}
              artifacts={activeTurnArtifacts}
              approvalPlan={safeSelectedTurnIndex === latestTurnIndex ? approvalPlan : null}
              onApprovePlan={safeSelectedTurnIndex === latestTurnIndex ? onApprovePlan : undefined}
              onRejectPlan={safeSelectedTurnIndex === latestTurnIndex ? onRejectPlan : undefined}
              canOpenPreview={canOpenPreview}
              onOpenPreview={onOpenPreview}
              fileBaseDir={fileBaseDir}
              pendingPermission={safeSelectedTurnIndex === latestTurnIndex ? pendingPermission : null}
              pendingQuestion={safeSelectedTurnIndex === latestTurnIndex ? pendingQuestion : null}
              onSubmitPermission={onSubmitPermission}
              onSubmitQuestion={onSubmitQuestion}
            />
          )}
        </div>
      </div>

      <div ref={messagesEndRef} />
    </div>
  )
}

/**
 * Todo item from TodoWrite tool
 */
interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

function hasMeaningfulTurnResult(turn: ConversationTurn): boolean {
  if (turn.thinkingMessages.length > 0) {
    return true
  }

  const content = turn.resultMessage?.content
  if (!content?.trim()) {
    return false
  }

  return !isPlaceholderAssistantResponse(content)
}

/**
 * Extract todo list from TodoWrite tool calls
 */
function extractTodosFromMessages(messages: AgentMessage[]): TodoItem[] | null {
  // Find the latest TodoWrite tool call
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.type === 'tool_use' && msg.toolName === 'TodoWrite' && msg.toolInput) {
      const todos = msg.toolInput.todos as TodoItem[] | undefined
      if (todos && Array.isArray(todos)) {
        return todos
      }
    }
  }
  return null
}

/**
 * 根据 TodoWrite 工具调用计算计划步骤状态
 * 优先使用 LLM 主动报告的进度，而不是推断
 */
function calculatePlanStepStatus(
  plan: TaskPlan,
  thinkingMessages: AgentMessage[],
  isComplete: boolean,
  hasExecutionError: boolean,
  latestApprovalTerminal?: ApprovalTerminalRecord | null
): TaskPlan {
  const isApprovalInterrupted = isInterruptedByApproval(latestApprovalTerminal?.status)

  const applyTerminalFailureStatus = (
    steps: TaskPlan['steps'],
    shouldFailPendingStep: boolean
  ): TaskPlan['steps'] => {
    if (!shouldFailPendingStep) {
      return steps
    }

    let hadInProgress = false
    const withFailedInProgress = steps.map((step) => {
      if (step.status === 'in_progress') {
        hadInProgress = true
        return { ...step, status: 'failed' as const }
      }
      return step
    })

    if (hadInProgress) {
      return withFailedInProgress
    }

    const firstPendingIndex = withFailedInProgress.findIndex(step => step.status === 'pending')
    if (firstPendingIndex === -1) {
      return withFailedInProgress
    }

    return withFailedInProgress.map((step, index) =>
      index === firstPendingIndex
        ? { ...step, status: 'failed' as const }
        : step
    )
  }

  // 1. 首先尝试从 TodoWrite 工具调用中提取步骤状态
  const todos = extractTodosFromMessages(thinkingMessages)

  if (todos && todos.length > 0) {
    // 使用 LLM 报告的 TodoWrite 状态
    let updatedSteps = plan.steps.map((step, index) => {
      // 尝试按索引匹配，或按内容匹配
      const todo = todos[index] || todos.find(t =>
        t.content.toLowerCase().includes(step.description.toLowerCase()) ||
        step.description.toLowerCase().includes(t.content.toLowerCase())
      )

      if (todo) {
        const newStatus = todo.status === 'in_progress' ? 'in_progress' :
                todo.status === 'completed' ? 'completed' : 'pending'
        return {
          ...step,
          status: newStatus as 'pending' | 'in_progress' | 'completed' | 'failed'
        }
      }

      // 如果没有匹配的 todo，保持原状态或根据完成度推断
      if (isComplete) {
        return { ...step, status: 'completed' as const }
      }
      return step
    })

    // 回合完成时，以回合完成态为准，避免 TodoWrite 残留 pending 造成“已完成但仍执行中”的假象。
    if (isComplete && !isApprovalInterrupted && !hasExecutionError) {
      updatedSteps = updatedSteps.map((step) =>
        step.status === 'failed' ? step : { ...step, status: 'completed' as const }
      )
    }

    return {
      ...plan,
      steps: applyTerminalFailureStatus(
        applyTerminalFailureStatus(updatedSteps, isApprovalInterrupted),
        hasExecutionError
      )
    }
  }

  // 2. 回退到基于工具调用数量的简单推断（当没有 TodoWrite 时）
  const toolResults = thinkingMessages.filter(m => m.type === 'tool_result')
  const completedTools = toolResults.filter(r => {
    const hasError = r.toolOutput?.includes('Error:') ||
      r.toolOutput?.includes('error') ||
      r.toolOutput?.startsWith('Failed')
    return !hasError
  }).length

  // 当前正在执行的工具
  const currentToolUse = thinkingMessages
    .filter(m => m.type === 'tool_use')
    .pop()
  const hasActiveTool = !!currentToolUse

  // 简单推断：根据工具完成数量和总步骤数的比例
  const progressRatio = plan.steps.length > 0 ? completedTools / plan.steps.length : 0

  const updatedSteps = plan.steps.map((step, index) => {
    // 如果步骤已经完成，保持完成状态
    if (step.status === 'completed') {
      return step
    }

    // 如果整个轮次完成，所有步骤标记为完成
    if (isComplete && !hasExecutionError) {
      return { ...step, status: 'completed' as const }
    }

    // 简单推断：基于进度比例
    const stepThreshold = (index + 1) / plan.steps.length
    if (progressRatio >= stepThreshold) {
      return { ...step, status: 'completed' as const }
    } else if (progressRatio >= stepThreshold - (1 / plan.steps.length) && hasActiveTool) {
      return { ...step, status: 'in_progress' as const }
    } else {
      return { ...step, status: 'pending' as const }
    }
  })

  return {
    ...plan,
    steps: applyTerminalFailureStatus(
      applyTerminalFailureStatus(updatedSteps, isApprovalInterrupted),
      hasExecutionError
    )
  }
}

/**
 * 将消息分组为对话轮次
 */
function groupIntoTurns(messages: AgentMessage[], isRunning: boolean, executionPlan?: TaskPlan | null): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentTurn: ConversationTurn | null = null
  let accumulatedText = ''
  let resultIsExplicit = false
  let lastAssistantTextWasContinuous = false

  for (const msg of messages) {
    // 跳过 session 消息
    if (msg.type === 'session') continue

    // Plan 消息关联到当前轮次（如果有的话），否则创建新轮次
    if (msg.type === 'plan') {
      const planData = msg.plan as TaskPlan | undefined
      if (currentTurn) {
        currentTurn.planMessage = msg
        currentTurn.plan = planData
      } else {
        // 创建一个只包含 plan 的轮次
        currentTurn = {
          id: msg.id,
          userMessage: undefined,
          thinkingMessages: [],
          resultMessage: undefined,
          planMessage: msg,
          plan: planData,
          isComplete: true
        }
        turns.push(currentTurn)
        currentTurn = null
      }
      continue
    }

    // 用户消息开始新一轮次 (支持 'user' 类型或 role === 'user' 的消息)
    if (msg.type === 'user' || (msg.role === 'user' && msg.type === 'text')) {
      if (currentTurn) {
        turns.push(currentTurn)
      }
      currentTurn = {
        id: msg.id,
        userMessage: msg,
        thinkingMessages: [],
        resultMessage: undefined,
        planMessage: undefined,
        isComplete: false
      }
      accumulatedText = ''
      resultIsExplicit = false
      lastAssistantTextWasContinuous = false
      continue
    }

    // 如果没有当前轮次，创建一个
    if (!currentTurn) {
      currentTurn = {
        id: `turn_${Date.now()}`,
        userMessage: undefined,
        thinkingMessages: [],
        resultMessage: undefined,
        planMessage: undefined,
        isComplete: false
      }
    }

    // 分类消息
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      currentTurn.thinkingMessages.push(msg)
      // 工具调用出现后，只清除明显的占位/过渡文案，保留有实际信息量的中间结果说明。
      if (
        msg.type === 'tool_use' &&
        currentTurn.resultMessage &&
        !resultIsExplicit &&
        isPlaceholderAssistantResponse(currentTurn.resultMessage.content)
      ) {
        currentTurn.resultMessage = undefined
      }
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'result') {
      currentTurn.resultMessage = {
        ...msg,
        isTemporary: false,
      }
      resultIsExplicit = true
      currentTurn.isComplete = true
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'clarification_request') {
      lastAssistantTextWasContinuous = false
      continue
    } else if (msg.type === 'done') {
      if (currentTurn.resultMessage && !resultIsExplicit) {
        currentTurn.resultMessage = {
          ...currentTurn.resultMessage,
          isTemporary: false,
        }
      }
      currentTurn.isComplete = resultIsExplicit || hasMeaningfulTurnResult(currentTurn)
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'text' && msg.role === 'assistant') {
      accumulatedText = lastAssistantTextWasContinuous
        ? `${accumulatedText}${msg.content || ''}`
        : (msg.content || '')
      lastAssistantTextWasContinuous = true

      const nextTextBlock = accumulatedText
      if (!isProcessAssistantResponse(nextTextBlock) || !currentTurn.resultMessage) {
        currentTurn.resultMessage = {
          ...msg,
          content: nextTextBlock,
          isTemporary: !resultIsExplicit,
        }
      }
    } else if (msg.type === 'error') {
      currentTurn.thinkingMessages.push(msg)
      lastAssistantTextWasContinuous = false
    } else {
      lastAssistantTextWasContinuous = false
    }
  }

  // 处理最后一个轮次
  if (currentTurn) {
    if (isRunning) {
      currentTurn.isComplete = false
    } else if (hasMeaningfulTurnResult(currentTurn)) {
      currentTurn.isComplete = true
      if (currentTurn.resultMessage && !resultIsExplicit) {
        currentTurn.resultMessage = {
          ...currentTurn.resultMessage,
          isTemporary: false,
        }
      }
    }
    turns.push(currentTurn)
  }

  return turns
}

function getTurnAnchorId(turnId: string, index: number): string {
  const normalizedId = turnId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `turn-${index + 1}-${normalizedId}`
}

function getMessagesForTurn(turn: ConversationTurn): AgentMessage[] {
  const orderedMessages: AgentMessage[] = []
  if (turn.userMessage) orderedMessages.push(turn.userMessage)
  if (turn.planMessage) orderedMessages.push(turn.planMessage)
  orderedMessages.push(...turn.thinkingMessages)
  if (turn.resultMessage) orderedMessages.push(turn.resultMessage)
  return orderedMessages
}

function getTurnLabel(turn: ConversationTurn, index: number): string {
  const sourceText = turn.userMessage?.content ||
    turn.resultMessage?.content ||
    turn.plan?.goal ||
    `回合 ${index + 1}`
  const normalized = sourceText.replace(/\s+/g, ' ').trim()
  if (!normalized) return `回合 ${index + 1}`
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized
}

const APPROVAL_INTERRUPT_PATTERNS = [
  /计划已被拒绝/,
  /审批(?:请求|流程)?已(?:拒绝|取消|超时|过期|中断|失效)/,
  /rejected by user/i,
  /\bapproval\b.*\b(reject(?:ed)?|cancel(?:ed)?|expire(?:d)?|orphan(?:ed)?)\b/i,
]

function hasApprovalInterruptText(content?: string): boolean {
  if (!content) return false
  const text = content.trim()
  if (!text) return false
  return APPROVAL_INTERRUPT_PATTERNS.some((pattern) => pattern.test(text))
}

function summarizeTurn({
  turn,
  turnIndex,
  latestTurnIndex,
  isRunning,
  isAwaitingApproval,
  isAwaitingClarification,
  taskStatus,
  latestApprovalTerminal,
}: {
  turn: ConversationTurn
  turnIndex: number
  latestTurnIndex: number
  isRunning: boolean
  isAwaitingApproval: boolean
  isAwaitingClarification: boolean
  taskStatus?: TaskStatus
  latestApprovalTerminal?: ApprovalTerminalRecord | null
}): TurnStatusSummary {
  const isLatestTurn = turnIndex === latestTurnIndex
  const isRunningTurn = isLatestTurn && isRunning
  const isAwaitingApprovalTurn = isLatestTurn && isAwaitingApproval
  const isAwaitingClarificationTurn = isLatestTurn && isAwaitingClarification
  const isStoppedTurn = isLatestTurn && taskStatus === 'stopped' && !isRunningTurn

  const hasPlan = !!(turn.planMessage || turn.plan)
  const hasExecutionTrace = turn.thinkingMessages.some(
    (m) => m.type === 'tool_use' || m.type === 'tool_result' || m.type === 'result' || m.type === 'done'
  )
  const hasResultMessage = !!turn.resultMessage?.content?.trim()
  const hasError = turn.thinkingMessages.some(
    (m) => m.type === 'error' || (m.type === 'tool_result' && m.toolOutput?.includes('Error:'))
  )
  const approvalInterruptedByText = hasApprovalInterruptText(turn.resultMessage?.content)
  const interruptedApprovalStatus = isLatestTurn
    ? (latestApprovalTerminal?.status || null)
    : null
  const hasInterruptedApproval =
    isInterruptedByApproval(interruptedApprovalStatus) || approvalInterruptedByText

  return {
    isLatestTurn,
    isRunning: isRunningTurn,
    isAwaitingApproval: isAwaitingApprovalTurn,
    isAwaitingClarification: isAwaitingClarificationTurn,
    isStopped: isStoppedTurn,
    hasPlan,
    hasExecutionTrace,
    hasResultMessage,
    hasError,
    hasInterruptedApproval,
    approvalInterruptedByText,
    interruptedApprovalStatus,
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatTimelineTimestamp(timestamp?: number): string {
  if (!timestamp) return '--:--'
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getTurnTimestamp(turn: ConversationTurn): number | undefined {
  return turn.userMessage?.timestamp || turn.resultMessage?.timestamp || turn.planMessage?.timestamp
}

function getTimelineSummary(turn: ConversationTurn, index: number): string {
  const sourceText = turn.userMessage?.content || turn.plan?.goal || turn.resultMessage?.content || `回合 ${index + 1}`
  return sourceText.replace(/\s+/g, ' ').trim() || `回合 ${index + 1}`
}

function getTimelineTone(summary: TurnStatusSummary): string {
  if (summary.isAwaitingApproval || summary.isAwaitingClarification || summary.isStopped || summary.hasInterruptedApproval) {
    return 'bg-[color:var(--ui-warning)]'
  }
  if (summary.hasError) {
    return 'bg-[color:var(--ui-danger)]'
  }
  if (summary.isRunning) {
    return 'bg-[color:var(--ui-accent)]'
  }
  return 'bg-[color:var(--ui-success)]'
}

function TimelineTurnItem({
  turn,
  index,
  isSelected,
  isLastVisible,
  summary,
  onSelect,
}: {
  turn: ConversationTurn
  index: number
  isSelected: boolean
  isLastVisible: boolean
  summary: TurnStatusSummary
  onSelect: () => void
}) {
  const timestamp = getTurnTimestamp(turn)
  const summaryText = getTimelineSummary(turn, index)

  return (
    <button
      onClick={onSelect}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ui-accent)]/35',
        isSelected
          ? 'bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_72%,transparent)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--ui-accent)_24%,transparent)]'
          : 'hover:bg-[color:color-mix(in_oklab,var(--ui-panel-2)_68%,transparent)]'
      )}
    >
      <div className="relative flex w-12 shrink-0 justify-center pt-1">
        {!isLastVisible && (
          <span className="absolute top-5 bottom-[-18px] left-1/2 w-px -translate-x-1/2 bg-border/60" />
        )}
        <span
          className={cn(
            'relative z-10 mt-1 size-2.5 rounded-full shadow-[0_0_0_4px_color-mix(in_oklab,var(--ui-panel)_86%,transparent)]',
            getTimelineTone(summary),
            summary.isRunning && 'animate-pulse',
            isSelected && 'size-3 shadow-[0_0_0_5px_color-mix(in_oklab,var(--ui-accent-soft)_75%,transparent)]'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{formatTimelineTimestamp(timestamp)}</span>
          <span className="text-[11px] text-muted-foreground/75">Turn {index + 1}</span>
        </div>
        <p className={cn('mt-1 line-clamp-2 text-sm leading-6', isSelected ? 'font-semibold text-foreground' : 'text-foreground/92')}>
          {summaryText}
        </p>
      </div>

      <div
        className={cn(
          'pointer-events-none absolute left-full top-1/2 z-30 ml-3 hidden w-[min(24rem,calc(100vw-8rem))] -translate-y-1/2 rounded-2xl border border-border/60',
          'bg-[color:color-mix(in_oklab,var(--ui-panel)_96%,transparent)] p-3 text-left shadow-[0_18px_40px_color-mix(in_oklab,var(--ui-panel)_35%,transparent)]',
          'group-hover:block group-focus-visible:block'
        )}
        aria-hidden="true"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{formatTimelineTimestamp(timestamp)}</span>
          <span className="text-[11px] text-muted-foreground/75">Turn {index + 1}</span>
        </div>
        <p className="mt-2 whitespace-normal break-words text-sm leading-6 text-foreground">
          {summaryText}
        </p>
      </div>
    </button>
  )
}

/**
 * 单个回合的工作区视图
 */
function SelectedTurnWorkspace({
  turnIndex,
  totalTurns,
  turn,
  isRunning,
  isLatestTurn,
  executionPlan,
  showPlan = true,
  isAwaitingApproval = false,
  isAwaitingClarification = false,
  taskStatus,
  isStopped = false,
  latestApprovalTerminal = null,
  artifacts,
  approvalPlan = null,
  onApprovePlan,
  onRejectPlan,
  canOpenPreview = false,
  onOpenPreview,
  fileBaseDir,
  pendingPermission,
  pendingQuestion,
  onSubmitPermission,
  onSubmitQuestion,
}: {
  turnIndex: number
  totalTurns: number
  turn: ConversationTurn
  isRunning: boolean
  isLatestTurn: boolean
  executionPlan?: TaskPlan | null
  showPlan?: boolean
  isAwaitingApproval?: boolean
  isAwaitingClarification?: boolean
  taskStatus?: TaskStatus
  isStopped?: boolean
  latestApprovalTerminal?: ApprovalTerminalRecord | null
  artifacts: ReturnType<typeof extractFilesFromMessages>
  approvalPlan?: TaskPlan | null
  onApprovePlan?: () => void
  onRejectPlan?: () => void
  canOpenPreview?: boolean
  onOpenPreview?: () => void
  fileBaseDir?: string
  pendingPermission?: PermissionRequest | null
  pendingQuestion?: PendingQuestion | null
  onSubmitPermission?: (permissionId: string, approved: boolean, addToAutoAllow?: boolean) => void
  onSubmitQuestion?: (questionId: string, answers: Record<string, string>) => void
}) {
  const hasExecutionTrace = turn.thinkingMessages.some(
    (m) => m.type === 'tool_use' || m.type === 'tool_result'
  )
  const hasError = turn.thinkingMessages.some(
    (m) => m.type === 'error' || (m.type === 'tool_result' && m.toolOutput?.includes('Error:'))
  )
  const hasTerminalExecutionError = shouldApplyTerminalExecutionFailure({
    hasExecutionError: hasError,
    isRunning,
    isTurnComplete: turn.isComplete,
  })
  const interruptedMeta = isLatestTurn
    ? getInterruptedStatusMeta(latestApprovalTerminal?.status)
    : null
  const turnTime = turn.userMessage?.timestamp || turn.resultMessage?.timestamp || turn.planMessage?.timestamp

  // 计算当前轮次的计划状态
  // 如果有执行计划且是最新轮次，使用执行计划并根据工具调用计算状态
  // 如果轮次已完成但有执行计划，将所有步骤标记为完成
  // 否则如果轮次有历史计划，显示历史计划
  let activePlan: TaskPlan | undefined
  if (executionPlan && isLatestTurn) {
    activePlan = calculatePlanStepStatus(
      executionPlan,
      turn.thinkingMessages,
      turn.isComplete,
      hasTerminalExecutionError,
      latestApprovalTerminal
    )
  } else if (turn.plan) {
    activePlan = hasExecutionTrace
      ? calculatePlanStepStatus(
        turn.plan,
        turn.thinkingMessages,
        turn.isComplete,
        hasTerminalExecutionError,
        latestApprovalTerminal
      )
      : turn.plan
  } else {
    activePlan = undefined
  }

  const hasRuntimeInteractions = !!pendingPermission || !!latestApprovalTerminal
  const isPlanOnlyStage =
    isLatestTurn &&
    (isAwaitingApproval || isAwaitingClarification) &&
    !turn.resultMessage &&
    turn.thinkingMessages.length === 0
  const shouldUseSingleColumn = isPlanOnlyStage && !!activePlan
  const thinkingToolCalls = turn.thinkingMessages.filter((m) => m.type === 'tool_use').length
  const planForApproval = approvalPlan || activePlan
  const displayModel = buildTurnDisplayModel({
    isStopped,
    isRunning,
    taskStatus,
    hasError,
    isLatestTurn,
    isAwaitingApproval,
    isAwaitingClarification,
    hasPlanForApproval: !!planForApproval,
    hasExecutionTrace,
    hasResultMessage: !!turn.resultMessage,
    artifacts,
    hasPendingPermission: !!pendingPermission,
    hasPendingQuestion: !!pendingQuestion,
    hasLatestApprovalTerminal: !!latestApprovalTerminal,
    hasPlan: !!activePlan,
    isTurnComplete: turn.isComplete,
    resultMessage: turn.resultMessage,
  })
  const displayPhase = displayModel.phase
  const visibleResult = displayModel.visibleResult
  const hasVisibleResult = visibleResult.kind !== 'none'
  const canRevealFinalOutput = turn.isComplete && !isRunning
  const shouldShowResult = hasRuntimeInteractions || hasVisibleResult
  const failureDetail = getPreferredFailureDetail(getMessagesForTurn(turn), turn.resultMessage?.content || null)

  return (
    <section
      id={getTurnAnchorId(turn.id, turnIndex - 1)}
      className={cn(
        'scroll-mt-20 rounded-3xl bg-[color:color-mix(in_oklab,var(--ui-panel)_90%,transparent)] p-5 shadow-[0_20px_48px_color-mix(in_oklab,var(--ui-panel)_30%,transparent)] sm:p-6',
        isLatestTurn && 'shadow-[0_20px_48px_color-mix(in_oklab,var(--ui-panel)_30%,transparent),0_0_0_1px_color-mix(in_oklab,var(--ui-accent)_14%,transparent)]'
      )}
    >
      {displayPhase === 'planning' && (
        <PlanningStateView isAwaitingClarification={isAwaitingClarification} />
      )}

      {displayPhase === 'stopped' && (
        <StoppedStateView />
      )}

      {displayPhase === 'failed' && (
        <div className="min-w-0 space-y-4">
          <FailedStateView message={failureDetail} />
          {displayModel.showPlanSection && activePlan && (
            <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-4 sm:px-5">
              <PlanExecutionView
                plan={activePlan}
                terminalStatus={latestApprovalTerminal?.status || null}
              />
            </section>
          )}
        </div>
      )}

      {displayPhase === 'awaiting_approval' && planForApproval && onApprovePlan && onRejectPlan && (
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              等待确认
            </span>
          </div>
          <PlanApproval
            plan={planForApproval}
            isWaitingApproval={true}
            onApprove={onApprovePlan}
            onReject={onRejectPlan}
          />
        </div>
      )}

      {displayPhase === 'awaiting_clarification' && pendingQuestion && onSubmitQuestion && (
        <div className="min-w-0 space-y-4">
          {displayModel.showPlanSection && activePlan && (
            <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-4 sm:px-5">
              <PlanExecutionView
                plan={activePlan}
                terminalStatus={latestApprovalTerminal?.status || null}
              />
            </section>
          )}

          <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center gap-3">
              <div className="w-4 shrink-0" />
              <div className="min-w-0 flex items-center gap-2">
                <HelpCircle className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">需要您的输入</span>
              </div>
            </div>

            <div className="pl-14">
              <QuestionView
                question={pendingQuestion}
                fileBaseDir={fileBaseDir}
                onSubmit={(answers) => onSubmitQuestion(pendingQuestion.id, answers)}
              />
            </div>
          </section>
        </div>
      )}

      {displayPhase === 'execution' && (
      <div className="min-w-0 space-y-4">
        {displayModel.showPlanSection && (
          <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-4 sm:px-5">
            <PlanExecutionView
              plan={activePlan!}
              terminalStatus={latestApprovalTerminal?.status || null}
            />
          </section>
        )}

        {displayModel.hasThinking && (
          <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-4 sm:px-5">
            {turn.thinkingMessages.length > 0 ? (
              <ThinkingSection
                messages={turn.thinkingMessages}
                isComplete={turn.isComplete && !isRunning}
                defaultCollapsed={true}
              />
            ) : (
              <div className="rounded-xl bg-[color:color-mix(in_oklab,var(--ui-panel)_78%,transparent)] px-3 py-4 text-sm text-muted-foreground">
                当前回合正在等待执行开始。
              </div>
            )}
          </section>
        )}

        {!shouldUseSingleColumn && shouldShowResult && (
          <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex w-6 shrink-0 items-center justify-center" aria-hidden="true">
                <span className="size-4" />
              </div>
              <div className="min-w-0 flex flex-1 items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium leading-none text-foreground">
                  {canRevealFinalOutput ? '最终输出' : '运行提示'}
                </span>
                {canRevealFinalOutput && canOpenPreview && onOpenPreview && (
                  <button
                    onClick={onOpenPreview}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)] px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
                  >
                    <Eye className="size-3.5" />
                    预览
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4 pl-14">
              {latestApprovalTerminal && !pendingPermission && !pendingQuestion && !isAwaitingApproval && !isAwaitingClarification && isLatestTurn && (
                <ApprovalTerminalNotice notice={latestApprovalTerminal} />
              )}

              {pendingPermission && onSubmitPermission && isLatestTurn && (
                <PermissionView
                  permission={pendingPermission}
                  onSubmit={(approved, addToAutoAllow) => onSubmitPermission(pendingPermission.id, approved, addToAutoAllow)}
                />
              )}

              {canRevealFinalOutput && visibleResult.text ? (
                <div className={cn(
                  'min-w-0 rounded-2xl px-4 py-4',
                  'bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)]'
                )}>
                  <MarkdownRenderer content={visibleResult.text} fileBaseDir={fileBaseDir} />
                </div>
              ) : null}

              {canRevealFinalOutput && visibleResult.artifacts.length > 0 && (
                <div className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{visibleResult.artifacts.length} 个文件</span>
                  </div>
                  <div className="space-y-2">
                    {visibleResult.artifacts.map((artifact) => (
                      <div key={artifact.id} className="rounded-xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_72%,transparent)] px-3 py-2.5">
                        <p className="truncate text-sm font-medium text-foreground">{artifact.name}</p>
                        {artifact.path && (
                          <p className="mt-1 truncate text-xs text-muted-foreground">{artifact.path}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      )}
    </section>
  )
}

function PlanningStateView({
  isAwaitingClarification = false,
}: {
  isAwaitingClarification?: boolean
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_74%,transparent)] px-2.5 py-1 text-xs font-medium text-[color:var(--ui-accent)]">
          {isAwaitingClarification ? '等待补充信息' : '规划中'}
        </span>
      </div>
      <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-5 sm:px-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>{isAwaitingClarification ? '正在等待补充信息后继续规划...' : '正在分析需求并生成执行计划...'}</span>
        </div>
        <div className="mt-4 space-y-3">
          <div className="h-3 rounded-full bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)]" />
          <div className="h-3 w-5/6 rounded-full bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)]" />
          <div className="h-3 w-2/3 rounded-full bg-[color:color-mix(in_oklab,var(--ui-panel)_82%,transparent)]" />
        </div>
      </section>
    </div>
  )
}

function StoppedStateView() {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[color:color-mix(in_oklab,var(--ui-warning-soft)_72%,transparent)] px-2.5 py-1 text-xs font-medium text-[color:var(--ui-warning)]">
          已终止
        </span>
      </div>
      <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-5 sm:px-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="size-4 text-[color:var(--ui-warning)]" />
          <span>当前回合已终止，未继续生成执行计划。</span>
        </div>
      </section>
    </div>
  )
}

function FailedStateView({ message }: { message?: string | null }) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[color:color-mix(in_oklab,var(--ui-danger-soft)_72%,transparent)] px-2.5 py-1 text-xs font-medium text-[color:var(--ui-danger)]">
          执行失败
        </span>
      </div>
      <section className="rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel-2)_58%,transparent)] px-4 py-5 sm:px-5">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[color:var(--ui-danger)]" />
          <div className="space-y-1">
            <p>当前回合已终止，未继续生成或执行后续计划。</p>
            {message && (
              <p className="break-words text-xs text-[color:var(--ui-danger)]/90">{message}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * PlanExecutionView - 执行中的计划视图（只读，显示在思考过程上方）
 */
function PlanExecutionView({
  plan,
  terminalStatus,
}: {
  plan: TaskPlan
  terminalStatus?: ApprovalTerminalStatus | null
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 计算完成进度
  const completedCount = plan.steps.filter(s => s.status === 'completed').length
  const inProgressCount = plan.steps.filter(s => s.status === 'in_progress').length
  const failedCount = plan.steps.filter(s => s.status === 'failed').length
  const isAllCompleted = completedCount === plan.steps.length
  const isInterrupted = isInterruptedByApproval(terminalStatus)
  const hasFailed = failedCount > 0

  return (
    <div className={cn(
      'rounded-2xl p-3',
      isInterrupted
        ? 'bg-rose-50/45 dark:bg-rose-950/20'
        : hasFailed
          ? 'bg-rose-50/35 dark:bg-rose-950/20'
          : isAllCompleted
        ? 'bg-emerald-50/35 dark:bg-emerald-950/20'
        : 'bg-accent/18'
    )}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-6 items-center gap-2">
            <ListTodo className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium leading-none text-foreground">执行计划</span>
            {isAllCompleted ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                已完成
              </span>
            ) : isInterrupted ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                已终止
              </span>
            ) : hasFailed ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                已失败
              </span>
            ) : inProgressCount > 0 ? (
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                执行中
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                待执行
              </span>
            )}
          </div>
        </div>
        <span className="text-sm text-muted-foreground">
          {completedCount}/{plan.steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-2 flex items-center gap-2 pl-14">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              isInterrupted || hasFailed
                ? "bg-rose-500"
                : isAllCompleted
                  ? "bg-emerald-500"
                  : "bg-primary"
            )}
            style={{ width: `${(completedCount / plan.steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      {isExpanded && (
        <div className="mt-3 space-y-1.5 pl-14">
          {plan.steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-start gap-2"
            >
              <div className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded text-[10px]",
                step.status === 'completed'
                  ? 'bg-emerald-500 text-white'
                  : step.status === 'in_progress'
                    ? 'bg-primary/20 text-primary'
                    : step.status === 'failed'
                      ? 'bg-rose-500 text-white'
                    : 'bg-muted text-muted-foreground'
              )}>
                {step.status === 'completed' ? (
                  <Check className="size-2.5" />
                ) : step.status === 'in_progress' ? (
                  <div className="size-1 animate-pulse rounded-full bg-primary" />
                ) : step.status === 'failed' ? (
                  <X className="size-2.5" />
                ) : (
                  index + 1
                )}
              </div>
              <span className={cn(
                "min-w-0 flex-1 text-xs leading-snug",
                step.status === 'completed'
                  ? 'text-muted-foreground line-through'
                  : step.status === 'in_progress'
                    ? 'font-medium text-foreground'
                    : step.status === 'failed'
                      ? 'font-medium text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground'
              )}>
                {step.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 审批终态提示（过期/孤儿化/取消/拒绝）
 */
function ApprovalTerminalNotice({
  notice,
}: {
  notice: ApprovalTerminalRecord
}) {
  const labelMap: Record<typeof notice.status, string> = {
    approved: '已批准',
    rejected: '已拒绝',
    expired: '已超时',
    canceled: '已取消',
    orphaned: '会话已失效',
  }

  const statusLabel = labelMap[notice.status]
  const defaultReason =
    notice.status === 'orphaned'
      ? '审批请求对应的执行会话已失效，请重新发起任务。'
      : notice.status === 'expired'
        ? '审批超时，请重新执行任务后再次审批。'
        : notice.status === 'canceled'
          ? '审批请求已取消，若仍需执行请重新发起。'
          : '审批请求已结束。'
  const text = notice.reason || defaultReason

  return (
    <div className="my-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
          <AlertCircle className="size-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            审批状态: {statusLabel}
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * 权限审批视图
 */
function PermissionView({
  permission,
  onSubmit,
}: {
  permission: PermissionRequest
  onSubmit: (approved: boolean, addToAutoAllow?: boolean) => void
}) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const metadata = permission.metadata as Record<string, unknown> | undefined
  const toolName = typeof metadata?.toolName === 'string' ? metadata.toolName.trim() : ''
  const canAddToAutoAllow = toolName.length > 0

  const handleSubmit = async (approved: boolean, addToAutoAllow = false) => {
    setIsSubmitting(true)
    try {
      await onSubmit(approved, addToAutoAllow)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="my-4 rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-4 dark:border-red-800 dark:from-red-950/30 dark:to-rose-950/30">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
          <ShieldAlert className="size-5 text-red-600 dark:text-red-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            权限审批
          </h3>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {permission.title}
          </p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {permission.description}
          </p>
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-500">
            类型: {permission.type}
          </p>
          {toolName && (
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">
              工具: {toolName}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {canAddToAutoAllow && (
          <button
            onClick={() => handleSubmit(true, true)}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
          >
            <Plus className="size-4" />
            批准并加入免审批
          </button>
        )}
        <button
          onClick={() => handleSubmit(false)}
          disabled={isSubmitting}
          className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-gray-700"
        >
          <X className="size-4" />
          拒绝
        </button>
        <button
          onClick={() => handleSubmit(true)}
          disabled={isSubmitting}
          className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          <Check className="size-4" />
          批准
        </button>
      </div>
    </div>
  )
}

/**
 * 用户问答视图
 */
function QuestionView({
  question,
  fileBaseDir,
  onSubmit,
}: {
  question: PendingQuestion
  fileBaseDir?: string
  onSubmit: (answers: Record<string, string>) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit(answers)
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = question.options
    ? (answers['selected']?.trim().length || 0) > 0 || (answers['freeText']?.trim().length || 0) > 0
    : answers['freeText']?.trim().length > 0

  return (
    <div className="my-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 dark:border-amber-800 dark:from-amber-950/30 dark:to-orange-950/30">
      {/* Header */}
        <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
          <HelpCircle className="size-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            需要您的输入
          </h3>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            <MarkdownRenderer content={question.question} fileBaseDir={fileBaseDir} />
          </div>
        </div>
      </div>

      {/* Options */}
      {question.options && question.options.length > 0 && (
        <div className="mt-4 space-y-2">
          {question.options.map((option, index) => (
            <button
              key={index}
              onClick={() => setAnswers((prev) => ({ ...prev, selected: option }))}
              className={cn(
                'w-full rounded-lg border p-3 text-left text-sm transition-colors',
                answers['selected'] === option
                  ? 'border-amber-500 bg-amber-100 dark:border-amber-400 dark:bg-amber-900/30'
                  : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* Free text input */}
      {(question.allowFreeText || !question.options?.length) && (
        <div className="mt-4">
          <textarea
            value={answers['freeText'] || ''}
            onChange={(e) => setAnswers((prev) => ({ ...prev, freeText: e.target.value }))}
            placeholder="请输入您的回答..."
            className="w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            rows={3}
          />
        </div>
      )}

      {/* Submit button */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              提交中...
            </>
          ) : (
            '提交回答'
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * 思考过程区域 - DeepSeek 风格的可折叠面板
 */
function ThinkingSection({
  messages,
  isComplete,
  defaultCollapsed = false,
}: {
  messages: AgentMessage[]
  isComplete: boolean
  defaultCollapsed?: boolean
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const toolCalls = messages.filter(m => m.type === 'tool_use')

  const hasError = messages.some(m =>
    m.type === 'error' ||
    (m.type === 'tool_result' && m.toolOutput?.includes('Error:'))
  )

  return (
    <div className="space-y-3">
      {/* 标题栏 - 可点击折叠 */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl bg-[color:color-mix(in_oklab,var(--ui-panel)_76%,transparent)] px-3 py-3 transition-colors hover:bg-[color:color-mix(in_oklab,var(--ui-panel)_84%,transparent)]"
        )}
      >
        {/* 折叠图标 */}
        <div className="flex w-6 shrink-0 items-center justify-center">
          {isCollapsed ? (
            <ChevronRight className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </div>

        <div className="min-w-0 flex min-h-6 flex-1 items-center gap-2">
          <Brain className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium leading-none text-foreground">
            {!isComplete ? '思考中...' : '思考过程'}
          </span>

          {isComplete && hasError && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              异常
            </span>
          )}

          {isComplete && !hasError && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              正常
            </span>
          )}

          {toolCalls.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {toolCalls.length} 次工具调用
            </span>
          )}
        </div>

      </button>

      {/* 内容区域 - 可折叠 */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out",
          isCollapsed ? "max-h-0 opacity-0" : "max-h-[640px] opacity-100 overflow-y-auto"
        )}
      >
        <div className="mt-2 ml-11 space-y-2 border-l-2 border-border/18 pl-5">
          {messages.map((msg) => (
            <ThinkingMessageItem key={msg.id} message={msg} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 思考过程中的单个消息
 */
function ThinkingMessageItem({ message }: { message: AgentMessage }) {
  if (message.type === 'tool_use') {
    const inputPreview = message.toolName === 'TodoWrite'
      ? formatTodoWriteInput(message.toolInput)
      : formatToolInput(message.toolInput)
    const fullInputPreview = message.toolName === 'TodoWrite'
      ? inputPreview
      : formatToolInput(message.toolInput, { truncateValues: false, maxEntries: 6 })

    return (
      <div className="flex items-start gap-2 py-1">
        <div className="flex-shrink-0 size-5 rounded bg-secondary/20 flex items-center justify-center mt-0.5">
          <Wrench className="size-3 text-secondary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">
              {message.toolName}
            </span>
          </div>
          {inputPreview && (
            <p
              className="text-xs text-muted-foreground mt-0.5 line-clamp-2"
              title={fullInputPreview || inputPreview}
            >
              {inputPreview}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (message.type === 'tool_result') {
    const isError = message.toolOutput?.includes('Error:') ||
      message.toolOutput?.includes('error') ||
      message.toolOutput?.startsWith('Failed')
    const hasOutput = message.toolOutput && message.toolOutput.trim().length > 0

    return (
      <div className="py-1 ml-7">
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 size-4 flex items-center justify-center mt-0.5">
            {isError ? (
              <AlertCircle className="size-3 text-destructive" />
            ) : (
              <CheckCircle2 className="size-3 text-green-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground"
            )}>
              {isError ? '执行失败' : '执行完成'}
            </p>
          </div>
        </div>
        {/* 显示工具输出内容 */}
        {hasOutput && (
          <ToolOutputDisplay
            output={message.toolOutput!}
            isError={isError || false}
          />
        )}
      </div>
    )
  }

  if (message.type === 'error') {
    return (
      <div className="flex items-start gap-2 py-1">
        <div className="flex-shrink-0 size-5 rounded bg-destructive/10 flex items-center justify-center mt-0.5">
          <AlertCircle className="size-3 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-destructive">
            {message.errorMessage || '发生错误'}
          </p>
        </div>
      </div>
    )
  }

  return null
}

function formatTodoWriteInput(input?: Record<string, unknown>): string {
  const todos = Array.isArray(input?.todos) ? (input?.todos as TodoItem[]) : []
  if (todos.length === 0) return formatToolInput(input)

  const completedCount = todos.filter(t => t.status === 'completed').length
  const inProgressCount = todos.filter(t => t.status === 'in_progress').length
  const pendingCount = todos.length - completedCount - inProgressCount

  return [
    `todos: ${todos.length}`,
    completedCount > 0 ? `completed: ${completedCount}` : null,
    inProgressCount > 0 ? `in_progress: ${inProgressCount}` : null,
    pendingCount > 0 ? `pending: ${pendingCount}` : null,
  ].filter(Boolean).join(', ')
}

/**
 * 格式化工具输入为简洁的预览文本
 */
function formatToolInput(
  input?: Record<string, unknown>,
  options: { truncateValues?: boolean; maxEntries?: number } = {}
): string {
  if (!input || Object.keys(input).length === 0) return ''

  const { truncateValues = true, maxEntries = 3 } = options
  const entries = Object.entries(input).slice(0, maxEntries)

  return entries.map(([key, value]) => {
    const valueStr = typeof value === 'string'
      ? truncateValues && value.length > 40 ? `${value.slice(0, 40)}...` : value
      : JSON.stringify(value)

    return `${key}: ${valueStr}`
  }).join(', ')
}

/**
 * 工具输出显示组件 - 可折叠展示输出内容
 */
function ToolOutputDisplay({ output, isError }: { output: string; isError: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 判断输出是否很长
  const isLongOutput = output.length > 200 || output.split('\n').length > 5

  // 获取预览文本
  const previewText = isLongOutput && !isExpanded
    ? output.slice(0, 200) + '...'
    : output

  return (
    <div className={cn(
      "mt-1.5 ml-6 rounded-md border text-xs overflow-hidden",
      isError
        ? "bg-destructive/5 border-destructive/20"
        : "bg-secondary/30 border-border/30"
    )}>
      {/* 输出内容 */}
      <div className="p-2 max-h-[300px] overflow-auto">
        <pre className={cn(
          "whitespace-pre-wrap break-all font-mono",
          isError ? "text-destructive/90" : "text-muted-foreground"
        )}>
          {previewText}
        </pre>
      </div>

      {/* 展开/折叠按钮 - 仅当输出很长时显示 */}
      {isLongOutput && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "w-full px-2 py-1 text-xs border-t flex items-center justify-center gap-1",
            "hover:bg-secondary/50 transition-colors",
            isError ? "border-destructive/20 text-destructive/70" : "border-border/30 text-muted-foreground"
          )}
        >
          {isExpanded ? (
            <>
              <ChevronDown className="size-3" />
              <span>收起</span>
            </>
          ) : (
            <>
              <ChevronRight className="size-3" />
              <span>展开全部 ({output.length} 字符)</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
