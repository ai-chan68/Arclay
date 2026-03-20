/**
 * useAgentNew hook - easywork style two-phase execution
 *
 * Two-phase execution:
 *   Phase 1: Planning - POST /v2/agent/plan → receive plan → awaiting approval
 *   Phase 2: Execution - user approves → POST /v2/agent/execute → stream execution
 *
 * Features:
 * - Plan approval workflow
 * - Permission request handling
 * - User question handling
 * - Attachment support
 * - Background task management
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  AgentMessage,
  AgentError,
  AgentErrorCode,
  TaskPlan,
  AgentPhase,
  AgentTurnState,
  PermissionRequest,
  PendingQuestion,
  MessageAttachment,
} from '@shared-types'
import { isAgentError } from '@shared-types'
import { getApiUrl } from '../api'
import {
  addBackgroundTask,
  removeBackgroundTask,
  updateBackgroundTaskStatus,
  updateBackgroundTaskMessages,
  getBackgroundTask,
} from '../lib/background-tasks'

/**
 * Parse SSE event line
 */
function parseEvent(line: string): { event: string; data: string } | null {
  if (line.startsWith('event:')) {
    return { event: line.slice(6).trim(), data: '' }
  }
  if (line.startsWith('data:')) {
    return { event: '', data: line.slice(5).trim() }
  }
  return null
}

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

interface ParsedApiError {
  status: number
  message: string
  code?: string
  data: Record<string, unknown>
}

const KNOWN_TURN_STATES: AgentTurnState[] = [
  'queued',
  'planning',
  'awaiting_approval',
  'awaiting_clarification',
  'executing',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]

function parseTurnState(value: unknown): AgentTurnState | null {
  if (typeof value !== 'string') return null
  return KNOWN_TURN_STATES.includes(value as AgentTurnState)
    ? (value as AgentTurnState)
    : null
}

function parseErrorCode(code: string | undefined, fallback: AgentErrorCode): AgentErrorCode {
  switch (code) {
    case 'AUTH_FAILED':
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'INVALID_REQUEST':
    case 'PROVIDER_ERROR':
    case 'TOOL_ERROR':
    case 'SESSION_NOT_FOUND':
    case 'EXECUTION_ABORTED':
    case 'EXECUTION_ERROR':
    case 'CONTINUE_ERROR':
    case 'PLAN_NOT_FOUND':
    case 'PLAN_STATE_CONFLICT':
    case 'TURN_NOT_FOUND':
    case 'TURN_STATE_CONFLICT':
    case 'TURN_VERSION_CONFLICT':
    case 'TURN_BLOCKED':
    case 'UNKNOWN_ERROR':
      return code
    default:
      return fallback
  }
}

async function parseApiError(response: Response): Promise<ParsedApiError> {
  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  const payload = data || {}
  const messageCandidates = [payload.error, payload.errorMessage, payload.message]
  const message = messageCandidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    || `HTTP error: ${response.status}`
  const code = typeof payload.code === 'string' && payload.code.trim().length > 0
    ? payload.code.trim()
    : undefined
  return {
    status: response.status,
    message,
    code,
    data: payload,
  }
}

function toAgentError(parsed: ParsedApiError, fallback: AgentErrorCode): AgentError {
  const codeFromStatus: AgentErrorCode =
    parsed.status === 400 ? 'INVALID_REQUEST'
      : parsed.status === 401 || parsed.status === 403 ? 'AUTH_FAILED'
      : parsed.status === 404 ? 'SESSION_NOT_FOUND'
      : parsed.status === 429 ? 'RATE_LIMITED'
      : parsed.status >= 500 ? 'PROVIDER_ERROR'
      : fallback

  const code = parseErrorCode(parsed.code, codeFromStatus)
  const defaultMessageByCode: Partial<Record<AgentErrorCode, string>> = {
    TURN_VERSION_CONFLICT: '执行失败：当前回合基于旧版本上下文，请重新规划后再执行。',
    TURN_STATE_CONFLICT: '执行失败：回合状态已变化，请刷新状态后重试。',
    TURN_BLOCKED: '当前回合仍被依赖回合阻塞，请等待依赖完成后重试。',
    TURN_NOT_FOUND: '执行失败：回合上下文不存在，请重新发起任务。',
    PLAN_STATE_CONFLICT: '执行失败：计划状态已变化，请重新规划。',
    PLAN_NOT_FOUND: '执行失败：计划不存在，可能已过期。',
  }

  return {
    code,
    message: defaultMessageByCode[code] || parsed.message,
    details: {
      ...parsed.data,
      httpStatus: parsed.status,
      rawCode: parsed.code || null,
    },
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  const parsed = await parseApiError(response)
  return parsed.message
}

function formatClarificationAnswers(answers: Record<string, string>): string {
  const normalized = Object.entries(answers)
    .map(([key, value]) => [key, (value || '').trim()] as const)
    .filter(([, value]) => value.length > 0)

  if (normalized.length === 0) return ''
  if (normalized.length === 1 && (normalized[0][0] === 'selected' || normalized[0][0] === 'freeText')) {
    return normalized[0][1]
  }

  return normalized.map(([key, value]) => `${key}: ${value}`).join('\n')
}

function buildClarificationFollowupPrompt(
  originalPrompt: string,
  question: PendingQuestion | null,
  answers: Record<string, string>
): string {
  const answerText = formatClarificationAnswers(answers)
  const questionText = (question?.question || '').trim()
  const base = originalPrompt.trim()

  const lines = [
    base,
    '',
    '[Clarification Context]',
    questionText ? `Question: ${questionText}` : '',
    answerText ? `Answer: ${answerText}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

type PlanningConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

function summarizePlanMessage(message: AgentMessage): string {
  if (!message.plan) {
    return ''
  }

  const plan = message.plan as TaskPlan
  const goal = typeof plan.goal === 'string' ? plan.goal.trim() : ''
  const steps = Array.isArray(plan.steps)
    ? plan.steps
      .map((step) => (step?.description || '').trim())
      .filter((item) => item.length > 0)
      .slice(0, 5)
    : []

  const lines: string[] = ['[Plan]']
  if (goal) {
    lines.push(`Goal: ${goal}`)
  }
  if (steps.length > 0) {
    lines.push(`Steps: ${steps.join(' | ')}`)
  }
  return lines.join('\n')
}

function buildPlanningConversation(messages: AgentMessage[], limit = 16): PlanningConversationMessage[] {
  const normalized: PlanningConversationMessage[] = []

  for (const message of messages) {
    if (message.type === 'session' || message.type === 'turn_state' || message.type === 'done') {
      continue
    }

    if (message.type === 'user' && message.role === 'user') {
      const content = (message.content || '').trim()
      if (content) {
        normalized.push({ role: 'user', content })
      }
      continue
    }

    if (message.type === 'text' && message.role === 'assistant') {
      const content = (message.content || '').trim()
      if (content) {
        normalized.push({ role: 'assistant', content })
      }
      continue
    }

    if (message.type === 'plan') {
      const planSummary = summarizePlanMessage(message)
      if (planSummary) {
        normalized.push({ role: 'assistant', content: planSummary })
      }
      continue
    }

    if (message.type === 'error') {
      const content = (message.errorMessage || '').trim()
      if (content) {
        normalized.push({ role: 'assistant', content: `[Error] ${content}` })
      }
    }
  }

  if (normalized.length <= limit) {
    return normalized
  }
  return normalized.slice(-limit)
}

export interface UseAgentNewState {
  messages: AgentMessage[]
  isRunning: boolean
  error: AgentError | null
  sessionId: string | null
  taskId: string | null
  taskIndex: number
  phase: AgentPhase
  plan: TaskPlan | null
  pendingPermission: PermissionRequest | null
  pendingQuestion: PendingQuestion | null
  latestApprovalTerminal: ApprovalTerminalRecord | null
  sessionFolder: string | null
  filesVersion: number
  turnId: string | null
  turnState: AgentTurnState | null
  taskVersion: number
  blockedByTurnIds: string[]
}

export interface UseAgentNewActions {
  runAgent: (
    prompt: string,
    existingTaskId?: string,
    sessionInfo?: SessionInfo,
    attachments?: MessageAttachment[],
    options?: RunAgentOptions
  ) => Promise<string>
  approvePlan: () => Promise<void>
  rejectPlan: () => void
  continueConversation: (reply: string, attachments?: MessageAttachment[]) => Promise<void>
  moveToBackground: () => void
  stopAgent: () => Promise<void>
  refreshPendingRequests: (taskId?: string) => Promise<void>
  refreshTurnRuntime: (taskId?: string) => Promise<void>
  respondToPermission: (permissionId: string, approved: boolean, addToAutoAllow?: boolean) => Promise<void>
  respondToQuestion: (questionId: string, answers: Record<string, string>) => Promise<void>
  resumeBlockedTurn: () => Promise<void>
  clear: () => void
}

export interface SessionInfo {
  sessionId: string
  taskIndex: number
  sessionFolder?: string
}

interface RunAgentOptions {
  appendUserMessage?: boolean
  reuseCurrentTurn?: boolean
}

export type UseAgentNewReturn = UseAgentNewState & UseAgentNewActions

export interface UseAgentNewOptions {
  autoClearOnError?: boolean
  maxMessages?: number
  externalMessages?: AgentMessage[]
  onMessagesChange?: (messages: AgentMessage[]) => void
  externalSessionId?: string | null
  onSessionIdChange?: (sessionId: string | null) => void
  externalPhase?: AgentPhase
  onPhaseChange?: (phase: AgentPhase) => void
  externalPlan?: TaskPlan | null
  onPlanChange?: (plan: TaskPlan | null) => void
  onMessageReceived?: (message: AgentMessage, taskId?: string) => Promise<void>
  onRunComplete?: (taskId: string, messages: AgentMessage[]) => void
  taskId?: string
  taskTitle?: string
  taskStatus?: string
  onMoveToBackground?: (taskId: string, messages: AgentMessage[], abortController: AbortController) => void
}

interface PendingRequestsResponse {
  pendingPermissions?: PermissionRequest[]
  pendingQuestions?: PendingQuestion[]
  pendingCount?: number
  latestTerminal?: ApprovalTerminalRecord | null
}

interface RuntimeTurnRecord {
  id: string
  state: AgentTurnState
  blockedByTurnIds?: string[]
  reason?: string | null
  readVersion?: number
  writeVersion?: number | null
}

interface RuntimeSnapshotResponse {
  runtime?: {
    version?: number
  }
  turns?: RuntimeTurnRecord[]
}

interface ApprovalTerminalRecord {
  id: string
  kind: 'permission' | 'question'
  status: 'approved' | 'rejected' | 'expired' | 'canceled' | 'orphaned'
  reason: string | null
  updatedAt: number
}

export function useAgentNew(options: UseAgentNewOptions = {}): UseAgentNewReturn {
  const {
    autoClearOnError = false,
    maxMessages = 1000,
    externalMessages,
    onMessagesChange,
    externalSessionId,
    onSessionIdChange,
    externalPhase,
    onPhaseChange,
    externalPlan,
    onPlanChange,
    onMessageReceived,
    onRunComplete,
    taskId,
    taskTitle,
    taskStatus,
    onMoveToBackground,
  } = options

  // Internal state
  const [internalMessages, setInternalMessages] = useState<AgentMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<AgentError | null>(null)
  const [internalSessionId, setInternalSessionId] = useState<string | null>(null)
  const [internalTaskId, setInternalTaskId] = useState<string | null>(null)
  const [taskIndex, setTaskIndex] = useState(1)
  const [internalPhase, setInternalPhase] = useState<AgentPhase>('idle')
  const [internalPlan, setInternalPlan] = useState<TaskPlan | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [latestApprovalTerminal, setLatestApprovalTerminal] = useState<ApprovalTerminalRecord | null>(null)
  const [sessionFolder, setSessionFolder] = useState<string | null>(null)
  const [filesVersion, setFilesVersion] = useState(0)
  const [turnId, setTurnId] = useState<string | null>(null)
  const [turnState, setTurnState] = useState<AgentTurnState | null>(null)
  const [taskVersion, setTaskVersion] = useState(0)
  const [blockedByTurnIds, setBlockedByTurnIds] = useState<string[]>([])

  // Use external state if provided
  const messages = externalMessages !== undefined ? externalMessages : internalMessages
  const sessionId = externalSessionId !== undefined ? externalSessionId : internalSessionId
  const phase = externalPhase !== undefined ? externalPhase : internalPhase
  const plan = externalPlan !== undefined ? externalPlan : internalPlan

  // Refs for stable callbacks
  const onMessageReceivedRef = useRef(onMessageReceived)
  const onRunCompleteRef = useRef(onRunComplete)
  const onMoveToBackgroundRef = useRef(onMoveToBackground)
  useEffect(() => { onMessageReceivedRef.current = onMessageReceived }, [onMessageReceived])
  useEffect(() => { onRunCompleteRef.current = onRunComplete }, [onRunComplete])
  useEffect(() => { onMoveToBackgroundRef.current = onMoveToBackground }, [onMoveToBackground])

  // Refs for current values
  const messagesRef = useRef(messages)
  const isRunningRef = useRef(isRunning)
  const taskIdRef = useRef(taskId)
  const taskTitleRef = useRef(taskTitle)
  const taskStatusRef = useRef(taskStatus)
  const sessionIdRef = useRef(sessionId)
  const phaseRef = useRef(phase)
  const planRef = useRef(plan)
  const pendingQuestionRef = useRef<PendingQuestion | null>(pendingQuestion)
  const attachmentsRef = useRef<MessageAttachment[] | undefined>(undefined)
  const turnIdRef = useRef<string | null>(turnId)
  const taskVersionRef = useRef<number>(taskVersion)

  messagesRef.current = messages
  isRunningRef.current = isRunning
  taskIdRef.current = taskId
  taskTitleRef.current = taskTitle
  taskStatusRef.current = taskStatus
  sessionIdRef.current = sessionId
  phaseRef.current = phase
  planRef.current = plan
  pendingQuestionRef.current = pendingQuestion
  turnIdRef.current = turnId
  taskVersionRef.current = taskVersion
  // attachmentsRef 在 runAgent 中设置

  const updateMessages = useCallback((newMessages: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[])) => {
    if (typeof newMessages === 'function') {
      const updated = newMessages(messagesRef.current)
      if (onMessagesChange) {
        onMessagesChange(updated)
      } else {
        setInternalMessages(updated)
      }
      messagesRef.current = updated
    } else {
      if (onMessagesChange) {
        onMessagesChange(newMessages)
      } else {
        setInternalMessages(newMessages)
      }
      messagesRef.current = newMessages
    }
  }, [onMessagesChange])

  const updateSessionId = useCallback((newSessionId: string | null) => {
    if (onSessionIdChange) {
      onSessionIdChange(newSessionId)
    } else {
      setInternalSessionId(newSessionId)
    }
  }, [onSessionIdChange])

  const updatePhase = useCallback((newPhase: AgentPhase) => {
    if (onPhaseChange) {
      onPhaseChange(newPhase)
    } else {
      setInternalPhase(newPhase)
    }
  }, [onPhaseChange])

  const updatePlan = useCallback((newPlan: TaskPlan | null) => {
    if (onPlanChange) {
      onPlanChange(newPlan)
    } else {
      setInternalPlan(newPlan)
    }
  }, [onPlanChange])

  const abortControllerRef = useRef<AbortController | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const initialPromptRef = useRef<string>('')
  const PLAN_STREAM_TIMEOUT_MS = 90 * 1000

  /**
   * Resolve prompt for the currently running task (for background metadata).
   */
  const resolveCurrentPrompt = useCallback((): string => {
    const userMessage = [...messagesRef.current]
      .reverse()
      .find(msg => msg.type === 'user' && typeof msg.content === 'string' && msg.content.trim().length > 0)
    return userMessage?.content?.trim() || initialPromptRef.current || ''
  }, [])

  /**
   * Move active stream reader to background mode so routing changes won't lose progress.
   */
  const moveCurrentRunToBackground = useCallback((): void => {
    if (!isRunningRef.current || !readerRef.current || !taskIdRef.current) {
      return
    }

    const currentMessages = [...messagesRef.current]
    const backgroundTaskId = taskIdRef.current
    const abortController = abortControllerRef.current || new AbortController()

    addBackgroundTask({
      taskId: backgroundTaskId,
      sessionId: sessionIdRef.current || '',
      prompt: resolveCurrentPrompt(),
      title: taskTitleRef.current || '后台任务',
      status: (taskStatusRef.current || 'running') as any,
      isRunning: true,
      messages: currentMessages,
      abortController,
    })

    if (onMoveToBackgroundRef.current) {
      onMoveToBackgroundRef.current(backgroundTaskId, currentMessages, abortController)
    }

    // Mark foreground as detached; current stream reader keeps running and writes into background task state.
    setIsRunning(false)
  }, [resolveCurrentPrompt])

  /**
   * Process SSE stream
   */
  const processStream = async (
    response: Response,
    currentTaskId: string,
    abortCtrl: AbortController
  ): Promise<void> => {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    readerRef.current = reader
    const decoder = new TextDecoder()
    let buffer = ''

    const handleDataLine = async (line: string): Promise<void> => {
      const parsed = parseEvent(line)
      if (!parsed?.data) return

      try {
        const message: AgentMessage = JSON.parse(parsed.data)

        if (message.type === 'text') {
          message.role = 'assistant'
        }

        if (message.type === 'session' && message.sessionId) {
          updateSessionId(message.sessionId)
        }

        if (message.type === 'turn_state' && message.turn) {
          setTurnId(message.turn.turnId)
          setTurnState(message.turn.state)
          setTaskVersion(message.turn.taskVersion)
          setBlockedByTurnIds(message.turn.blockedByTurnIds || [])
          if (message.turn.state === 'blocked') {
            updatePhase('blocked')
          } else if (message.turn.state === 'planning') {
            updatePhase('planning')
          } else if (message.turn.state === 'awaiting_approval') {
            updatePhase('awaiting_approval')
          } else if (message.turn.state === 'awaiting_clarification') {
            updatePhase('awaiting_clarification')
          } else if (message.turn.state === 'executing') {
            updatePhase('executing')
          }
        }

        if (message.type === 'plan' && message.plan) {
          updatePlan(message.plan as TaskPlan)
          updatePhase('awaiting_approval')
          setPendingQuestion(null)
          setLatestApprovalTerminal(null)
        }

        if (message.type === 'permission_request' && message.permission) {
          setPendingPermission(message.permission)
        }

        if (message.type === 'user' && message.question) {
          setPendingQuestion(message.question)
          updatePhase('awaiting_clarification')
        }

        if (message.type === 'clarification_request') {
          const clarification = message.clarification || message.question
          if (clarification) {
            setPendingQuestion(clarification)
            updatePhase('awaiting_clarification')
          }
        }

        if (message.type === 'error') {
          setError({
            code: 'PROVIDER_ERROR',
            message: message.errorMessage || 'Unknown error',
          })
        }

        if (message.type !== 'session') {
          await onMessageReceivedRef.current?.(message, currentTaskId)
          const bgTask = getBackgroundTask(currentTaskId)
          if (bgTask?.isRunning) {
            updateBackgroundTaskMessages(currentTaskId, [...bgTask.messages, message])
          } else {
            updateMessages(prev => {
              const newMessages = [...prev, message]
              return newMessages.length > maxMessages
                ? newMessages.slice(-maxMessages)
                : newMessages
            })
          }
        }
      } catch {
        // Skip unparseable data
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          await handleDataLine(line)
        }
      }

      // Process trailing buffered line in case the stream closes without a final newline.
      if (buffer.trim().length > 0) {
        await handleDataLine(buffer.trim())
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      throw err
    } finally {
      readerRef.current = null
    }
  }

  /**
   * Run agent - Phase 1: Planning
   */
  const runAgent = useCallback(async (
    prompt: string,
    existingTaskId?: string,
    sessionInfo?: SessionInfo,
    attachments?: MessageAttachment[],
    options?: RunAgentOptions
  ): Promise<string> => {
    // Move current task to background first, then start a new foreground run.
    moveCurrentRunToBackground()

    const effectiveTaskId = existingTaskId || generateId('task')
    initialPromptRef.current = prompt
    attachmentsRef.current = attachments
    const planningConversation = buildPlanningConversation(messagesRef.current)

    if (!options?.reuseCurrentTurn) {
      setTurnId(null)
      setTurnState(null)
      setBlockedByTurnIds([])
    }

    console.log('[useAgentNew] runAgent called:', { prompt: prompt.slice(0, 50), effectiveTaskId, attachmentsCount: attachments?.length || 0 })

    setError(null)
    setIsRunning(true)
    updatePhase('planning')
    setPendingPermission(null)
    setPendingQuestion(null)
    setLatestApprovalTerminal(null)
    setInternalTaskId(effectiveTaskId)

    if (sessionInfo) {
      updateSessionId(sessionInfo.sessionId)
      setTaskIndex(sessionInfo.taskIndex)
      setSessionFolder(sessionInfo.sessionFolder || null)
    }

    if (options?.appendUserMessage !== false) {
      const userMessage: AgentMessage = {
        id: generateId('user'),
        type: 'user',
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
        attachments,
      }
      updateMessages(prev => [...prev, userMessage])
      await onMessageReceivedRef.current?.(userMessage, effectiveTaskId)
    }

    abortControllerRef.current = new AbortController()

    let planningTimedOut = false

    try {
      // Check if has image attachments - skip planning if so
      const hasImages = attachments?.some(att => att.type.startsWith('image/'))

      if (hasImages) {
        // Skip planning for image inputs
        updatePhase('executing')
        await executeDirect(effectiveTaskId, prompt, attachments)
      } else {
        // Phase 1: Planning
        const apiUrl = await getApiUrl('/api/v2/agent/plan')
        console.log('[useAgentNew] Calling plan API:', apiUrl)

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            taskId: effectiveTaskId,
            sessionId: sessionInfo?.sessionId,
            turnId: options?.reuseCurrentTurn ? (turnIdRef.current || undefined) : undefined,
            readVersion: taskVersionRef.current,
            conversation: planningConversation,
          }),
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const apiError = await parseApiError(response)
          throw toAgentError(apiError, 'PROVIDER_ERROR')
        }

        const timeoutId = setTimeout(() => {
          planningTimedOut = true
          abortControllerRef.current?.abort()
        }, PLAN_STREAM_TIMEOUT_MS)

        try {
          await processStream(response, effectiveTaskId, abortControllerRef.current)
        } finally {
          clearTimeout(timeoutId)
        }

        if (planningTimedOut && phaseRef.current !== 'awaiting_approval' && phaseRef.current !== 'awaiting_clarification') {
          throw new Error('规划阶段超时，请检查模型配置或网络连接后重试。')
        }
      }

      return effectiveTaskId
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (planningTimedOut) {
          const timeoutMessage = '规划阶段超时，请检查模型配置或网络连接后重试。'
          setError({
            code: 'TIMEOUT',
            message: timeoutMessage,
            details: { phase: 'planning' },
          })
          const errorEvent: AgentMessage = {
            id: generateId('msg'),
            type: 'error',
            errorMessage: timeoutMessage,
            timestamp: Date.now(),
          }
          updateMessages(prev => [...prev, errorEvent])
          await onMessageReceivedRef.current?.(errorEvent, effectiveTaskId)
        }
        return effectiveTaskId
      }

      if (isAgentError(err)) {
        console.error('[useAgentNew] Agent error:', err.code, err.message)
        setError(err)

        if (autoClearOnError) {
          updateMessages([])
        }

        updatePhase('idle')
        return effectiveTaskId
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('[useAgentNew] Error:', errorMessage)
      setError({ code: 'NETWORK_ERROR', message: errorMessage })

      if (autoClearOnError) {
        updateMessages([])
      }

      updatePhase('idle')
      return effectiveTaskId
    } finally {
      const awaitingInteraction =
        phaseRef.current === 'awaiting_approval' ||
        phaseRef.current === 'awaiting_clarification' ||
        phaseRef.current === 'blocked'
      const backgroundTask = getBackgroundTask(effectiveTaskId)
      const completionMessages = backgroundTask?.messages ?? messagesRef.current

      if (backgroundTask) {
        updateBackgroundTaskStatus(effectiveTaskId, false)
      }
      setIsRunning(false)
      abortControllerRef.current = null
      if (!awaitingInteraction) {
        updatePhase('idle')
        onRunCompleteRef.current?.(effectiveTaskId, completionMessages)
      }
    }
  }, [maxMessages, autoClearOnError, moveCurrentRunToBackground, updateMessages, updateSessionId, updatePhase, updatePlan])

  /**
   * Execute directly (for image inputs or simple queries)
   */
  const executeDirect = async (
    currentTaskId: string,
    prompt: string,
    attachments?: MessageAttachment[]
  ): Promise<void> => {
    const apiUrl = await getApiUrl('/api/v2/agent')
    console.log('[useAgentNew] Direct execution:', apiUrl)

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        sessionId: sessionIdRef.current,
        attachments,
      }),
      signal: abortControllerRef.current?.signal,
    })

    if (!response.ok) {
      const apiError = await parseApiError(response)
      throw toAgentError(apiError, 'EXECUTION_ERROR')
    }

    await processStream(response, currentTaskId, abortControllerRef.current!)
  }

  /**
   * Approve plan - Phase 2: Execution
   */
  const approvePlan = useCallback(async (): Promise<void> => {
    if (!planRef.current || !internalTaskId) return

    console.log('[useAgentNew] Approving plan:', planRef.current.id)
    updatePhase('executing')
    setIsRunning(true)

    abortControllerRef.current = new AbortController()

    try {
      const apiUrl = await getApiUrl('/api/v2/agent/execute')
      console.log('[useAgentNew] Calling execute API:', apiUrl)

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: planRef.current.id,
          prompt: initialPromptRef.current,
          workDir: sessionFolder || undefined,
          taskId: internalTaskId,
          sessionId: sessionIdRef.current,
          attachments: attachmentsRef.current,
          turnId: turnIdRef.current,
          readVersion: taskVersionRef.current,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const apiError = await parseApiError(response)
        const mappedError = toAgentError(apiError, 'EXECUTION_ERROR')
        setError(mappedError)

        const turnStateFromError = parseTurnState(apiError.data.turnState)
        if (turnStateFromError) {
          setTurnState(turnStateFromError)
        }

        const taskVersionFromError = apiError.data.taskVersion
        if (typeof taskVersionFromError === 'number' && Number.isFinite(taskVersionFromError)) {
          setTaskVersion(Math.max(0, Math.floor(taskVersionFromError)))
        }

        if (mappedError.code === 'TURN_BLOCKED' || turnStateFromError === 'blocked') {
          updatePhase('blocked')
        } else {
          updatePhase('idle')
        }
        return
      }

      await processStream(response, internalTaskId, abortControllerRef.current)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError({ code: 'EXECUTION_ERROR', message: errorMessage })
    } finally {
      const backgroundTask = getBackgroundTask(internalTaskId)
      const completionMessages = backgroundTask?.messages ?? messagesRef.current

      if (backgroundTask) {
        updateBackgroundTaskStatus(internalTaskId, false)
      }
      setIsRunning(false)
      updatePlan(null)
      if (phaseRef.current !== 'blocked') {
        updatePhase('idle')
      }
      abortControllerRef.current = null
      onRunCompleteRef.current?.(internalTaskId, completionMessages)
    }
  }, [internalTaskId, sessionFolder, updatePhase, updatePlan])

  /**
   * Reject plan
   */
  const rejectPlan = useCallback((): void => {
    console.log('[useAgentNew] Rejecting plan')
    const rejectedPlanId = planRef.current?.id
    updatePlan(null)
    updatePhase('idle')
    setIsRunning(false)
    setTurnState('cancelled')
    setPendingPermission(null)
    setPendingQuestion(null)
    setLatestApprovalTerminal({
      id: generateId('terminal'),
      kind: 'permission',
      status: 'rejected',
      reason: 'Rejected by user from UI.',
      updatedAt: Date.now(),
    })

    if (rejectedPlanId) {
      void (async () => {
        try {
          const apiUrl = await getApiUrl('/api/v2/agent/plan/reject')
          await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              planId: rejectedPlanId,
              reason: 'Rejected by user from UI.',
            }),
          })
        } catch (err) {
          console.warn('[useAgentNew] Failed to mark plan rejected on server:', err)
        }
      })()
    }

    // Add rejection message
    const rejectMessage: AgentMessage = {
      id: generateId('msg'),
      type: 'text',
      role: 'assistant',
      content: '计划已被拒绝。您可以重新描述需求或提出新的任务。',
      timestamp: Date.now(),
    }
    updateMessages(prev => [...prev, rejectMessage])
    onMessageReceivedRef.current?.(rejectMessage, internalTaskId || undefined)
  }, [internalTaskId, updatePhase, updatePlan, updateMessages])

  /**
   * Continue conversation
   */
  const continueConversation = useCallback(async (
    reply: string,
    attachments?: MessageAttachment[]
  ): Promise<void> => {
    if (!internalTaskId) return

    // Add user reply message
    const userMessage: AgentMessage = {
      id: generateId('user'),
      type: 'user',
      role: 'user',
      content: reply,
      timestamp: Date.now(),
      attachments,
    }
    updateMessages(prev => [...prev, userMessage])
    await onMessageReceivedRef.current?.(userMessage, internalTaskId)

    // Continue execution
    setIsRunning(true)
    updatePhase('executing')
    abortControllerRef.current = new AbortController()

    try {
      // 构建对话历史（排除当前刚添加的用户消息）
      const conversationHistory = messagesRef.current
        .filter(msg => msg.type !== 'session')  // 排除 session 类型消息
        .map(msg => ({
          role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: msg.content || '',
        }))

      const apiUrl = await getApiUrl('/api/v2/agent')
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: reply,
          sessionId: sessionIdRef.current,
          taskId: internalTaskId,
          attachments,
          conversation: conversationHistory,  // 传递对话历史
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      await processStream(response, internalTaskId, abortControllerRef.current)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError({ code: 'CONTINUE_ERROR', message: errorMessage })
    } finally {
      const backgroundTask = getBackgroundTask(internalTaskId)
      const completionMessages = backgroundTask?.messages ?? messagesRef.current

      if (backgroundTask) {
        updateBackgroundTaskStatus(internalTaskId, false)
      }
      setIsRunning(false)
      updatePhase('idle')
      abortControllerRef.current = null
      onRunCompleteRef.current?.(internalTaskId, completionMessages)
    }
  }, [internalTaskId, updatePhase, updateMessages])

  /**
   * Stop agent
   */
  const stopAgent = useCallback(async (): Promise<void> => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    if (sessionIdRef.current) {
      try {
        const apiUrl = await getApiUrl(`/api/v2/agent/stop/${sessionIdRef.current}`)
        await fetch(apiUrl, { method: 'POST' })
      } catch {
        // Ignore stop errors
      }
    }

    setIsRunning(false)
    updatePhase('idle')
  }, [updatePhase])

  /**
   * Refresh pending permission/question requests from backend.
   * Used for page refresh recovery when no SSE event is currently flowing.
   */
  const refreshPendingRequests = useCallback(async (targetTaskId?: string): Promise<void> => {
    try {
      if (
        taskStatusRef.current === 'completed' ||
        taskStatusRef.current === 'error' ||
        taskStatusRef.current === 'stopped'
      ) {
        setPendingPermission(null)
        setPendingQuestion(null)
        setLatestApprovalTerminal(null)
        updatePhase('idle')
        return
      }

      const apiUrl = await getApiUrl('/api/v2/agent/pending')
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      const url = new URL(apiUrl, baseOrigin)
      const effectiveTaskId = targetTaskId || taskIdRef.current || undefined

      if (effectiveTaskId) {
        // Prefer task-level scoping. Session IDs may rotate between planning/executing.
        url.searchParams.set('taskId', effectiveTaskId)
      } else if (sessionIdRef.current) {
        url.searchParams.set('sessionId', sessionIdRef.current)
      }

      const response = await fetch(url.toString())
      if (!response.ok) {
        return
      }

      const data = (await response.json()) as PendingRequestsResponse
      const nextPermission = Array.isArray(data.pendingPermissions) ? data.pendingPermissions[0] : null
      const nextQuestion = Array.isArray(data.pendingQuestions) ? data.pendingQuestions[0] : null

      setPendingPermission(nextPermission || null)
      setPendingQuestion(nextQuestion || null)
      if (nextQuestion) {
        if (nextQuestion.source === 'clarification') {
          updatePhase('awaiting_clarification')
        } else if (nextQuestion.source === 'runtime_tool_question') {
          if (phaseRef.current === 'idle') {
            updatePhase('executing')
          }
        } else if (phaseRef.current === 'idle') {
          // Backward compatible fallback for old records without source.
          updatePhase('awaiting_clarification')
        }
      } else if (nextPermission && phaseRef.current === 'idle') {
        updatePhase('awaiting_approval')
      }

      if (nextPermission || nextQuestion) {
        setLatestApprovalTerminal(null)
      } else {
        const terminal = data.latestTerminal
        const shouldShowTerminal =
          !!terminal &&
          (terminal.status === 'expired' ||
            terminal.status === 'orphaned' ||
            terminal.status === 'canceled' ||
            terminal.status === 'rejected')
        if (
          shouldShowTerminal &&
          (phaseRef.current === 'awaiting_approval' || phaseRef.current === 'awaiting_clarification')
        ) {
          updatePhase('idle')
        }
        setLatestApprovalTerminal(shouldShowTerminal ? terminal : null)
      }
    } catch (err) {
      console.error('[useAgentNew] Failed to refresh pending requests:', err)
    }
  }, [])

  const refreshTurnRuntime = useCallback(async (targetTaskId?: string): Promise<void> => {
    try {
      if (
        taskStatusRef.current === 'completed' ||
        taskStatusRef.current === 'error' ||
        taskStatusRef.current === 'stopped'
      ) {
        setTurnState(null)
        setBlockedByTurnIds([])
        updatePhase('idle')
        return
      }

      const effectiveTaskId = targetTaskId || taskIdRef.current || undefined
      if (!effectiveTaskId) return

      const apiUrl = await getApiUrl(`/api/v2/agent/runtime/${effectiveTaskId}`)
      const response = await fetch(apiUrl)
      if (!response.ok) return

      const data = (await response.json()) as RuntimeSnapshotResponse
      const turns = Array.isArray(data.turns) ? data.turns : []
      const currentTurn = turnIdRef.current
        ? turns.find((item) => item.id === turnIdRef.current)
        : turns[turns.length - 1]

      if (currentTurn) {
        setTurnId(currentTurn.id)
        setTurnState(currentTurn.state)
        setBlockedByTurnIds(currentTurn.blockedByTurnIds || [])
        if (currentTurn.state === 'blocked') updatePhase('blocked')
        if (currentTurn.state === 'planning') updatePhase('planning')
        if (currentTurn.state === 'awaiting_approval') updatePhase('awaiting_approval')
        if (currentTurn.state === 'awaiting_clarification') updatePhase('awaiting_clarification')
        if (currentTurn.state === 'executing') updatePhase('executing')
        if (currentTurn.state === 'completed' || currentTurn.state === 'failed' || currentTurn.state === 'cancelled') {
          updatePhase('idle')
        }
      }

      const runtimeVersion = data.runtime?.version
      if (typeof runtimeVersion === 'number' && Number.isFinite(runtimeVersion)) {
        setTaskVersion(Math.max(0, Math.floor(runtimeVersion)))
      }
    } catch (err) {
      console.error('[useAgentNew] Failed to refresh turn runtime:', err)
    }
  }, [updatePhase])

  /**
   * Respond to permission request
   */
  const respondToPermission = useCallback(async (
    permissionId: string,
    approved: boolean,
    addToAutoAllow?: boolean
  ): Promise<void> => {
    try {
      const apiUrl = await getApiUrl('/api/v2/agent/permission')
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionId, approved, addToAutoAllow: !!addToAutoAllow }),
      })
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response))
      }

      const result = await response.json().catch(() => null) as { success?: boolean } | null
      if (result && result.success === false) {
        throw new Error('权限审批回传失败')
      }

      await refreshPendingRequests(taskIdRef.current || undefined)
    } catch (err) {
      console.error('[useAgentNew] Failed to respond to permission:', err)
    }
  }, [refreshPendingRequests])

  /**
   * Respond to question
   */
  const respondToQuestion = useCallback(async (
    questionId: string,
    answers: Record<string, string>
  ): Promise<void> => {
    try {
      const apiUrl = await getApiUrl('/api/v2/agent/question')
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, answers }),
      })
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response))
      }

      const result = await response.json().catch(() => null) as {
        success?: boolean
        nextAction?: 'resume_planning' | 'resume_execution'
        turnId?: string | null
      } | null
      if (result && result.success === false) {
        throw new Error('澄清问题回传失败')
      }

      const resolvedQuestion = pendingQuestionRef.current

      if (result?.turnId) {
        setTurnId(result.turnId)
      }

      setPendingQuestion(null)
      setLatestApprovalTerminal(null)
      pendingQuestionRef.current = null

      if (result?.nextAction === 'resume_execution') {
        updatePhase('executing')
      } else if (result?.nextAction === 'resume_planning') {
        updatePhase('planning')
      }

      await refreshPendingRequests(taskIdRef.current || undefined)

      const shouldRerunPlanning =
        (result?.nextAction
          ? result.nextAction === 'resume_planning'
          : resolvedQuestion?.source === 'clarification') &&
        !!taskIdRef.current

      if (shouldRerunPlanning) {
        const followupPrompt = buildClarificationFollowupPrompt(
          initialPromptRef.current,
          resolvedQuestion,
          answers,
        )
        await runAgent(
          followupPrompt,
          taskIdRef.current || undefined,
          sessionIdRef.current
            ? {
                sessionId: sessionIdRef.current,
                taskIndex,
                sessionFolder: sessionFolder || undefined,
              }
            : undefined,
          attachmentsRef.current,
          { appendUserMessage: false, reuseCurrentTurn: true }
        )
      }
    } catch (err) {
      console.error('[useAgentNew] Failed to respond to question:', err)
    }
  }, [refreshPendingRequests, runAgent, taskIndex, sessionFolder])

  const resumeBlockedTurn = useCallback(async (): Promise<void> => {
    if (phaseRef.current !== 'blocked') return
    if (!internalTaskId || !turnIdRef.current) return

    await runAgent(
      initialPromptRef.current,
      internalTaskId,
      sessionIdRef.current
        ? {
            sessionId: sessionIdRef.current,
            taskIndex,
            sessionFolder: sessionFolder || undefined,
          }
        : undefined,
      attachmentsRef.current,
      {
        appendUserMessage: false,
        reuseCurrentTurn: true,
      }
    )
  }, [internalTaskId, runAgent, sessionFolder, taskIndex])

  /**
   * Clear all state
   */
  const clear = useCallback((): void => {
    updateMessages([])
    setError(null)
    updateSessionId(null)
    setInternalTaskId(null)
    setTaskIndex(1)
    updatePhase('idle')
    updatePlan(null)
    setPendingPermission(null)
    setPendingQuestion(null)
    setLatestApprovalTerminal(null)
    setSessionFolder(null)
    setFilesVersion(0)
    setTurnId(null)
    setTurnState(null)
    setTaskVersion(0)
    setBlockedByTurnIds([])
  }, [updateMessages, updateSessionId, updatePhase, updatePlan])

  // Poll pending approvals/questions while execution is active or waiting for interaction.
  // This complements SSE and ensures permission prompts can recover across refresh/reconnect.
  useEffect(() => {
    const shouldPoll =
      phase === 'executing' ||
      phase === 'awaiting_approval' ||
      phase === 'awaiting_clarification' ||
      phase === 'blocked'
    if (!taskIdRef.current || !shouldPoll) return

    let canceled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async (): Promise<void> => {
      if (canceled) return
      await refreshPendingRequests(taskIdRef.current || undefined)
      if (
        phaseRef.current === 'awaiting_approval' ||
        phaseRef.current === 'awaiting_clarification' ||
        phaseRef.current === 'blocked'
      ) {
        await refreshTurnRuntime(taskIdRef.current || undefined)
      }
      if (canceled) return
      timer = setTimeout(poll, 1500)
    }

    poll().catch((err) => {
      console.error('[useAgentNew] Pending poll failed:', err)
    })

    return () => {
      canceled = true
      if (timer) clearTimeout(timer)
    }
  }, [phase, refreshPendingRequests, refreshTurnRuntime])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      moveCurrentRunToBackground()

      const activeTaskId = taskIdRef.current
      const shouldKeepBackgroundStream = !!(
        readerRef.current &&
        activeTaskId &&
        getBackgroundTask(activeTaskId)?.isRunning
      )

      if (!shouldKeepBackgroundStream && abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (!shouldKeepBackgroundStream && readerRef.current) {
        readerRef.current.cancel()
      }
    }
  }, [moveCurrentRunToBackground])

  return {
    // State
    messages,
    isRunning,
    error,
    sessionId,
    taskId: internalTaskId,
    taskIndex,
    phase,
    plan,
    pendingPermission,
    pendingQuestion,
    latestApprovalTerminal,
    sessionFolder,
    filesVersion,
    turnId,
    turnState,
    taskVersion,
    blockedByTurnIds,
    // Actions
    runAgent,
    approvePlan,
    rejectPlan,
    continueConversation,
    moveToBackground: moveCurrentRunToBackground,
    stopAgent,
    refreshPendingRequests,
    refreshTurnRuntime,
    respondToPermission,
    respondToQuestion,
    resumeBlockedTurn,
    clear,
  }
}
