/**
 * TaskDetail - 任务详情页面 (easywork Style Two-Phase Execution)
 *
 * easywork-style workflow:
 *   Phase 1: Planning - POST /v2/agent/plan → receive plan → awaiting approval
 *   Phase 2: Execution - user approves → POST /v2/agent/execute → stream execution
 *
 * Features:
 * - Plan approval workflow (PlanApproval component)
 * - Permission request handling
 * - User question handling (QuestionInput component)
 * - Attachment support (ChatInput component)
 * - Background task management
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import {
  PanelLeft,
  ArrowDown,
  Loader2,
  CalendarClock,
  AlertTriangle,
} from 'lucide-react'

import { useSidebar } from '@/components/task-detail/SidebarContext'
import { LeftSidebar, type UITask } from '@/components/task-detail/LeftSidebar'
import { RightSidebar } from '@/components/task-detail/RightSidebar'
import { TaskMessageList, type TurnStatusSummary } from '@/components/task-detail/TaskMessageList'
import { ChatInput } from '@/components/task-detail/ChatInput'
import type { Artifact } from '@/shared/types/artifacts'
import {
  extractFilesFromMessage,
  pickPrimaryArtifactForPreview,
  shouldPromotePreviewSelection,
  sortArtifactsForPreview,
} from '@/shared/lib/file-utils'
import { useAgentNew } from '@/shared/hooks/useAgentNew'
import { useDatabase, dbMessageToAgentMessage } from '@/shared/hooks/useDatabase'
import type { AgentMessage, TaskStatus, AgentPhase, TaskPlan, MessageAttachment, AgentError } from '@shared-types'
import {
  generateSessionId,
  deriveStatusFromMessages,
  isTaskActivelyRunning,
  resolveTaskStatus,
  getPreferredFailureDetail,
  removeBackgroundTask,
  getBackgroundTask,
  updateBackgroundTaskStatus,
  subscribeToBackgroundTasks,
} from '@/shared/lib'

interface LocationState {
  prompt?: string
  sessionId?: string
  taskIndex?: number
  attachments?: MessageAttachment[]
}

const TASK_TURN_SELECTION_STORAGE_KEY = 'easywork-task-turn-selection'

/** Generate task title from prompt */
function generateTaskTitle(prompt: string): string {
  const cleanPrompt = prompt.trim()
  if (!cleanPrompt) return '新任务'

  const prefixesToRemove = [
    '请', '帮我', '帮忙', '可以', '能否', '能不能', '麻烦', '你好',
    '我想', '我需要', '我要', '想要', '希望', '请问', '如何', '怎么', '怎样'
  ]

  let title = cleanPrompt
  for (const prefix of prefixesToRemove) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trim()
      break
    }
  }
  title = title.replace(/[。！？?.!]+$/, '')
  if (!title.trim()) title = cleanPrompt

  const maxLength = 40
  if (title.length <= maxLength) return title

  const punctuationIndex = title.slice(0, maxLength).search(/[。！？?.!]/)
  if (punctuationIndex > 10) return title.slice(0, punctuationIndex)

  const commaIndex = title.slice(0, maxLength).search(/[，；,;]/)
  if (commaIndex > 10) return title.slice(0, commaIndex)

  const spaceIndex = title.slice(0, maxLength).lastIndexOf(' ')
  if (spaceIndex > 10) return title.slice(0, spaceIndex)

  return title.slice(0, maxLength - 3) + '...'
}

function getTurnHeaderTitle(messages: AgentMessage[], fallbackTitle: string): string {
  const primaryMessage = messages.find((message) => (
    message.type === 'user' && message.role === 'user' && message.content?.trim()
  )) || messages.find((message) => (
    message.type === 'text' && message.role === 'user' && message.content?.trim()
  )) || messages.find((message) => (
    message.type === 'result' && message.content?.trim()
  )) || messages.find((message) => (
    message.type === 'text' && message.role === 'assistant' && message.content?.trim()
  ))

  const content = primaryMessage?.content?.replace(/\s+/g, ' ').trim()
  return content || fallbackTitle
}

function getTaskErrorNotice(
  error: AgentError | null,
  messages: AgentMessage[]
): { title: string; detail: string; tone: 'warning' | 'danger' } | null {
  if (!error) return null

  const preferredDetail = getPreferredFailureDetail(messages, error.message) || error.message || '任务执行过程中发生错误。'

  switch (error.code) {
    case 'TURN_VERSION_CONFLICT':
      return {
        title: '回合版本冲突',
        detail: '当前计划基于旧任务版本，请重新发起规划后再执行。',
        tone: 'warning',
      }
    case 'TURN_BLOCKED':
      return {
        title: '回合依赖未满足',
        detail: '当前回合依赖前序回合结果，请等待依赖完成后重试。',
        tone: 'warning',
      }
    case 'TURN_STATE_CONFLICT':
    case 'PLAN_STATE_CONFLICT':
      return {
        title: '状态冲突',
        detail: '计划或回合状态已变化，请刷新后重试。',
        tone: 'warning',
      }
    case 'TURN_NOT_FOUND':
    case 'PLAN_NOT_FOUND':
      return {
        title: '上下文已失效',
        detail: '当前回合或计划不存在，请重新发起任务。',
        tone: 'danger',
      }
    default:
      return {
        title: '执行失败',
        detail: preferredDetail,
        tone: 'danger',
      }
  }
}

function TaskDetailContent() {
  const { taskId } = useParams<{ taskId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null
  const initialPrompt = state?.prompt || ''
  const initialSessionId = state?.sessionId || ''
  const initialTaskIndex = state?.taskIndex || 1
  const initialAttachments = state?.attachments || []

  const {
    isLeftOpen,
    toggleLeft,
    isRightOpen,
    setRightOpen,
    rightPanelWidth,
    setRightPanelWidth,
  } = useSidebar()

  // Database
  const {
    isReady: isDbReady, loadAllTasks, createTask: dbCreateTask,
    updateTask: dbUpdateTask, deleteTask: dbDeleteTask,
    loadMessages, countMessages, saveMessage, getTask,
  } = useDatabase()

  // Task state
  const [tasks, setTasks] = useState<UITask[]>([])
  const [currentTask, setCurrentTask] = useState<UITask | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Messages and execution state (controlled by useAgentNew)
  const [currentMessages, setCurrentMessages] = useState<AgentMessage[]>([])
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [currentPhase, setCurrentPhase] = useState<AgentPhase>('idle')
  const [currentPlan, setCurrentPlan] = useState<TaskPlan | null>(null)
  // Track the plan being executed (for showing progress during execution)
  const [executionPlan, setExecutionPlan] = useState<TaskPlan | null>(null)

  // Background tasks
  const [backgroundRunningIds, setBackgroundRunningIds] = useState<string[]>([])

  // Refs
  const currentTaskIdRef = useRef<string | null>(taskId || null)
  const hasInitializedRef = useRef(false)
  const manuallyStoppedTaskIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => { currentTaskIdRef.current = taskId || null }, [taskId])

  // Load task list from DB on mount - 只在任务列表为空时加载，避免覆盖已有数据
  useEffect(() => {
    if (!isDbReady || tasks.length > 0) return
    let cancelled = false
    async function load() {
      try {
        console.log('[TaskDetail] Loading tasks from DB...')
        const dbTasks = await loadAllTasks()
        console.log('[TaskDetail] Loaded tasks:', dbTasks.length)
        if (!cancelled) {
          const messageCounts = await Promise.all(
            dbTasks.map(async (task) => [task.id, await countMessages(task.id)] as const)
          )
          const messageCountMap = new Map(messageCounts)
          const loadedTasks = dbTasks.map(t => ({
            ...t,
            title: generateTaskTitle(t.prompt),
            phase: 'idle' as const,
            selectedArtifactId: null,
            previewMode: 'static' as const,
            isRightSidebarVisible: false,
            messages: [],
            hasMessageHistory: (messageCountMap.get(t.id) || 0) > 0,
          }))
          setTasks(prev => {
            // Avoid overriding a just-created in-memory task while the initial DB load is in-flight.
            if (prev.length === 0) return loadedTasks
            const existingIds = new Set(prev.map(t => t.id))
            const missingTasks = loadedTasks.filter(t => !existingIds.has(t.id))
            if (missingTasks.length === 0) return prev
            return [...prev, ...missingTasks]
          })
        }
      } catch (error) {
        console.error('[TaskDetail] Failed to load tasks:', error)
      }
    }
    load()
    return () => { cancelled = true }
  }, [countMessages, isDbReady, loadAllTasks, tasks.length])

  // Message persistence callback
  const handleMessageReceived = useCallback(async (message: AgentMessage, msgTaskId?: string) => {
    const tid = msgTaskId || currentTaskIdRef.current
    if (tid) {
      await saveMessage(tid, message)
    }
  }, [saveMessage])

  // Run complete callback
  const handleRunComplete = useCallback((runTaskId: string, messages: AgentMessage[]) => {
    if (runTaskId && isDbReady) {
      if (manuallyStoppedTaskIdsRef.current.has(runTaskId)) {
        return
      }
      const derivedStatus = deriveStatusFromMessages(messages, false)
      if (derivedStatus === 'running') {
        return
      }
      getTask(runTaskId).then(existing => {
        if (existing) {
          // Respect manual stop: do not override stopped -> completed/error.
          if (existing.status === 'stopped') return
          if (existing.status !== 'running') return
          dbUpdateTask(runTaskId, { status: derivedStatus })
        }
      }).catch(console.error)
    }
  }, [dbUpdateTask, isDbReady, getTask])

  // Use new two-phase execution hook
  const {
    isRunning,
    error,
    pendingPermission,
    pendingQuestion,
    latestApprovalTerminal,
    runAgent,
    approvePlan,
    rejectPlan,
    moveToBackground,
    stopAgent,
    refreshPendingRequests,
    refreshTurnRuntime,
    respondToPermission,
    respondToQuestion,
    resumeBlockedTurn,
    resetTransientState,
    turnId,
    turnState,
    taskVersion,
    blockedByTurnIds,
  } = useAgentNew({
    externalMessages: currentMessages,
    onMessagesChange: (messages) => {
      setCurrentMessages(messages)
      // Sync to tasks list in memory
      if (currentTask) {
        setTasks(prev => prev.map(t =>
          t.id === currentTask.id
            ? { ...t, messages, updated_at: new Date().toISOString(), hasMessageHistory: messages.length > 0 }
            : t
        ))
        setCurrentTask(prev => (
          prev
            ? { ...prev, hasMessageHistory: messages.length > 0 }
            : prev
        ))
      }
    },
    externalSessionId: currentRunId,
    onSessionIdChange: setCurrentRunId,
    externalPhase: currentPhase,
    onPhaseChange: setCurrentPhase,
    externalPlan: currentPlan,
    onPlanChange: setCurrentPlan,
    onMessageReceived: handleMessageReceived,
    onRunComplete: handleRunComplete,
    taskId: currentTask?.id,
    taskTitle: currentTask?.title,
    taskStatus: currentTask?.status,
  })

  useEffect(() => {
    return subscribeToBackgroundTasks((bgTasks) => {
      setBackgroundRunningIds(bgTasks.filter(t => t.isRunning).map(t => t.taskId))
      const activeBgTask = taskId ? bgTasks.find(t => t.taskId === taskId && t.isRunning) : undefined
      if (activeBgTask && !isRunning) {
        // Background task keeps a full in-memory timeline. Replace instead of merge
        // to avoid duplicate rendering when DB and in-memory message IDs differ.
        setCurrentMessages(activeBgTask.messages)
        setCurrentPhase(prev => (
          prev === 'awaiting_approval' || prev === 'awaiting_clarification'
            ? prev
            : 'executing'
        ))
      }
    })
  }, [taskId, isRunning])

  const isCurrentTaskRunning = useMemo(() => {
    const hasActiveForegroundPhase = isTaskActivelyRunning({
      phase: currentPhase,
      error,
    })
    if (!taskId) return isRunning
    return isRunning || backgroundRunningIds.includes(taskId) || hasActiveForegroundPhase
  }, [taskId, isRunning, backgroundRunningIds, currentPhase, error])

  // UI state
  const [showScrollButton, setShowScrollButton] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isRightSidebarVisible = isRightOpen

  // Artifacts
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null)
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0)
  const [selectedTurnMessages, setSelectedTurnMessages] = useState<AgentMessage[]>([])
  const [turnsCount, setTurnsCount] = useState(0)
  const [taskTurnSelections, setTaskTurnSelections] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem(TASK_TURN_SELECTION_STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const sanitized: Record<string, number> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          sanitized[key] = Math.floor(value)
        }
      }
      return sanitized
    } catch (error) {
      console.warn('[TaskDetail] Failed to parse turn selection cache:', error)
      return {}
    }
  })
  const taskTurnSelectionsRef = useRef<Record<string, number>>({})

  useEffect(() => {
    taskTurnSelectionsRef.current = taskTurnSelections
  }, [taskTurnSelections])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(TASK_TURN_SELECTION_STORAGE_KEY, JSON.stringify(taskTurnSelections))
  }, [taskTurnSelections])

  // ========== INITIALIZATION ==========
  // 当 taskId 变化时重置初始化状态
  useEffect(() => {
    if (!taskId) return
    // taskId 变化时重置初始化标志
    hasInitializedRef.current = false
    resetTransientState()
    setIsLoading(true)
    setCurrentRunId(null)
    setCurrentMessages([])
    setCurrentPlan(null)
    setExecutionPlan(null)
    setCurrentPhase('idle')
    const nextTurnIndex = taskTurnSelectionsRef.current[taskId] ?? 0
    setSelectedTurnIndex(nextTurnIndex)
    setSelectedTurnMessages([])
    setTurnsCount(0)
    setArtifacts([])
    setSelectedArtifact(null)
  }, [taskId, resetTransientState])

  useEffect(() => {
    if (!taskId || !isDbReady || hasInitializedRef.current) return
    hasInitializedRef.current = true

    async function initialize() {
      // Check if task already exists in DB
      const existingTask = await getTask(taskId!)

      if (existingTask) {
        // === EXISTING TASK: load from DB ===
        console.log('[TaskDetail] Loading existing task:', taskId)
        const uiTask: UITask = {
          ...existingTask,
          title: generateTaskTitle(existingTask.prompt),
          phase: 'idle' as const,
          selectedArtifactId: null,
          previewMode: 'static' as const,
          isRightSidebarVisible: false,
          messages: [],
          hasMessageHistory: null,
        }
        setCurrentTask(uiTask)
        // Ensure task is in the sidebar list
        setTasks(prev => {
          if (prev.some(t => t.id === taskId)) return prev
          return [uiTask, ...prev]
        })

        // Load messages
        const activeBackgroundTask = getBackgroundTask(taskId!)
        try {
          const dbMessages = await loadMessages(taskId!)
          const agentMessages = dbMessages.map(dbMessageToAgentMessage)
          const restoredMessages = activeBackgroundTask?.isRunning
            ? activeBackgroundTask.messages
            : agentMessages
          const hasMessageHistory = restoredMessages.length > 0
          setCurrentTask(prev => prev ? { ...prev, hasMessageHistory } : prev)
          setTasks(prev => prev.map(t => (
            t.id === taskId
              ? { ...t, hasMessageHistory }
              : t
          )))
          if (restoredMessages.length > 0) {
            setCurrentMessages(restoredMessages)
          }
          if (activeBackgroundTask?.isRunning) {
            setCurrentPhase(prev => (
              prev === 'awaiting_approval' || prev === 'awaiting_clarification'
                ? prev
                : 'executing'
            ))
          }
        } catch (err) {
          console.error('[TaskDetail] Failed to load messages:', err)
        }

        setIsLoading(false)
        return
      }

      // === NEW TASK: create and run ===
      if (initialPrompt) {
        console.log('[TaskDetail] Creating new task:', taskId, initialPrompt.slice(0, 50))
        const sessionId = initialSessionId || generateSessionId()
        const taskIndex = initialTaskIndex

        const now = new Date().toISOString()
        const newTask: UITask = {
          id: taskId!,
          session_id: sessionId,
          task_index: taskIndex,
          prompt: initialPrompt,
          title: generateTaskTitle(initialPrompt),
          status: 'running' as TaskStatus,
          phase: 'idle' as const,
          cost: null,
          duration: null,
          favorite: false,
          selectedArtifactId: null,
          previewMode: 'static' as const,
          isRightSidebarVisible: false,
          created_at: now,
          updated_at: now,
          messages: [],
          hasMessageHistory: null,
        }

        setCurrentTask(newTask)
        setTasks(prev => [newTask, ...prev])
        setCurrentMessages([])
        setIsLoading(false)

        // Persist to DB then run
        try {
          await dbCreateTask({
            id: taskId!,
            session_id: sessionId,
            task_index: taskIndex,
            prompt: initialPrompt,
          })
        } catch (err) {
          console.error('[TaskDetail] Failed to persist task:', err)
        }

        // Start two-phase execution
        runAgent(initialPrompt, taskId!, { sessionId, taskIndex }, initialAttachments)
      } else {
        // No prompt and task not in DB - redirect to home
        console.log('[TaskDetail] No prompt and no existing task, redirecting to home')
        navigate('/', { replace: true })
      }
    }

    initialize()
  }, [taskId, isDbReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update task status when messages/running state changes
  useEffect(() => {
    if (currentTask && currentMessages.length > 0) {
      const backgroundTask = getBackgroundTask(currentTask.id)
      const effectiveIsRunning =
        isCurrentTaskRunning ||
        !!backgroundTask?.isRunning ||
        isTaskActivelyRunning({
          phase: currentPhase,
          error,
        })
      const interruptedByApproval =
        latestApprovalTerminal?.status === 'rejected' ||
        latestApprovalTerminal?.status === 'expired' ||
        latestApprovalTerminal?.status === 'canceled' ||
        latestApprovalTerminal?.status === 'orphaned'
      const manuallyStopped = manuallyStoppedTaskIdsRef.current.has(currentTask.id)
      const statusFromTurnState =
        turnState === 'completed'
          ? 'completed'
          : turnState === 'failed'
          ? 'error'
          : turnState === 'cancelled'
          ? 'stopped'
          : null
      const derivedStatus = deriveStatusFromMessages(currentMessages, effectiveIsRunning)
      const newStatus = resolveTaskStatus({
        currentStatus: currentTask.status,
        derivedStatus,
        isRunning: effectiveIsRunning,
        interruptedByApproval,
        manuallyStopped,
        statusFromTurnState,
      })
      if (newStatus !== currentTask.status) {
        const updatedTask = { ...currentTask, status: newStatus, updated_at: new Date().toISOString() }
        setCurrentTask(updatedTask)
        setTasks(prev => prev.map(t => t.id === currentTask.id ? updatedTask : t))
        if (isDbReady) {
          getTask(currentTask.id).then(existing => {
            if (existing) dbUpdateTask(currentTask.id, { status: newStatus })
          }).catch(console.error)
        }
        if (backgroundTask) {
          // Preserve actual background runtime flag; avoid flipping running->false
          // during task-switch hydration windows.
          updateBackgroundTaskStatus(currentTask.id, backgroundTask.isRunning, newStatus)
        }
      }
    }
  }, [currentMessages, isCurrentTaskRunning, currentTask, currentPhase, latestApprovalTerminal?.status, isDbReady, dbUpdateTask, getTask, error, turnState])

  const visibleTurnMessages = useMemo(() => {
    if (turnsCount > 0) {
      return selectedTurnMessages
    }
    return currentMessages
  }, [turnsCount, selectedTurnMessages, currentMessages])

  // Extract artifacts from currently selected turn
  useEffect(() => {
    const extractedArtifacts: Artifact[] = []
    const seenPaths = new Set<string>()

    // Iterate from latest to oldest so newest files are prioritized
    for (let i = visibleTurnMessages.length - 1; i >= 0; i--) {
      const msg = visibleTurnMessages[i]
      const msgArtifacts = extractFilesFromMessage(msg)
      msgArtifacts.forEach((artifact) => {
        if (artifact.path && !seenPaths.has(artifact.path)) {
          seenPaths.add(artifact.path)
          // Use file path based ID for consistency
          const artifactId = `artifact-${artifact.path}`
          extractedArtifacts.push({
            ...artifact,
            id: artifactId
          })
        }
      })
    }

    setArtifacts(extractedArtifacts)

    const sortedArtifacts = sortArtifactsForPreview(extractedArtifacts)
    const preferredArtifact = pickPrimaryArtifactForPreview(sortedArtifacts)
    const selectedStillExists = !!selectedArtifact &&
      sortedArtifacts.some(a => a.path === selectedArtifact.path)

    // Always keep selected artifact scoped to current turn/task.
    if (sortedArtifacts.length === 0) {
      setSelectedArtifact(null)
      return
    }

    // Always repair stale selection, even during running state.
    if ((!selectedArtifact || !selectedStillExists) && preferredArtifact) {
      setSelectedArtifact(preferredArtifact)
      return
    }

    // During active execution, avoid aggressive auto-switching once selection is valid.
    if (isCurrentTaskRunning) {
      return
    }

    // Keep preview aligned with likely final output only when candidate is clearly better.
    if (
      selectedArtifact &&
      preferredArtifact &&
      selectedArtifact.path !== preferredArtifact.path &&
      shouldPromotePreviewSelection(selectedArtifact, preferredArtifact)
    ) {
      setSelectedArtifact(preferredArtifact)
    }
  }, [visibleTurnMessages, isCurrentTaskRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRightResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isRightSidebarVisible) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = rightPanelWidth

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX
      setRightPanelWidth(startWidth + delta)
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
  }, [isRightSidebarVisible, rightPanelWidth, setRightPanelWidth])

  // Scroll management
  const checkScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    setShowScrollButton(scrollHeight - scrollTop - clientHeight > 200)
  }, [])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    container.addEventListener('scroll', checkScrollPosition)
    return () => container.removeEventListener('scroll', checkScrollPosition)
  }, [checkScrollPosition])

  const scrollToBottom = useCallback(() => {
    messagesContainerRef.current?.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [])

  // ========== TASK ACTIONS ==========

  const handleSelectTask = useCallback((id: string) => {
    if (currentTask && isRunning && currentTask.id !== id) {
      moveToBackground()
    }
    navigate(`/task/${id}`)
  }, [navigate, currentTask, isRunning, moveToBackground])

  const handleNewTask = useCallback(() => {
    if (currentTask && isRunning) {
      moveToBackground()
    }
    navigate('/')
  }, [navigate, currentTask, isRunning, moveToBackground])

  const handleDeleteTask = useCallback(async (id: string) => {
    const bgTask = getBackgroundTask(id)
    if (bgTask) {
      bgTask.abortController.abort()
      removeBackgroundTask(id)
    }
    if (isDbReady) await dbDeleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    setTaskTurnSelections(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (id === taskId) navigate('/')
  }, [taskId, navigate, isDbReady, dbDeleteTask])

  const handleToggleFavorite = useCallback((id: string, favorite: boolean) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, favorite } : t))
    if (isDbReady) {
      getTask(id).then(existing => {
        if (existing) dbUpdateTask(id, { favorite })
      }).catch(console.error)
    }
  }, [isDbReady, dbUpdateTask, getTask])

  // Handle chat input submit
  const handleChatSubmit = useCallback(async (text: string, attachments?: MessageAttachment[]) => {
    if (!text.trim() || !taskId) return
    if (isCurrentTaskRunning) return
    if (currentPhase === 'awaiting_approval' || currentPhase === 'awaiting_clarification' || currentPhase === 'blocked') return

    manuallyStoppedTaskIdsRef.current.delete(taskId)

    // Start a new turn: clear previous execution plan snapshot
    setExecutionPlan(null)

    // Update task status to running
    if (isDbReady) {
      getTask(taskId).then(existing => {
        if (existing) dbUpdateTask(taskId, { status: 'running' })
      }).catch(console.error)
    }

    const sessionId = currentTask?.session_id || generateSessionId()
    const taskIndex = currentTask?.task_index || 1

    await runAgent(
      text,
      taskId,
      { sessionId, taskIndex },
      attachments
    )
  }, [isCurrentTaskRunning, taskId, currentPhase, isDbReady, dbUpdateTask, getTask, currentTask, runAgent])

  // Handle plan approval
  const handleApprovePlan = useCallback(async () => {
    // Save the current plan as execution plan before starting execution
    if (currentPlan) {
      setExecutionPlan(currentPlan)
    }
    await approvePlan()
  }, [approvePlan, currentPlan])

  // Handle plan rejection
  const handleRejectPlan = useCallback(() => {
    setExecutionPlan(null)
    rejectPlan()
  }, [rejectPlan])

  // Handle permission response
  const handlePermissionResponse = useCallback(async (
    permissionId: string,
    approved: boolean,
    addToAutoAllow?: boolean
  ) => {
    await respondToPermission(permissionId, approved, addToAutoAllow)
  }, [respondToPermission])

  // Handle question response
  const handleQuestionResponse = useCallback(async (questionId: string, answers: Record<string, string>) => {
    await respondToQuestion(questionId, answers)
  }, [respondToQuestion])

  const handleResumeBlockedTurn = useCallback(async () => {
    await resumeBlockedTurn()
  }, [resumeBlockedTurn])

  const handleStopAgent = useCallback(async () => {
    if (!taskId) return
    manuallyStoppedTaskIdsRef.current.add(taskId)
    await stopAgent()

    const nowIso = new Date().toISOString()
    setTasks(prev => prev.map(t => (
      t.id === taskId
        ? { ...t, status: 'stopped' as TaskStatus, updated_at: nowIso }
        : t
    )))
    setCurrentTask(prev => (
      prev && prev.id === taskId
        ? { ...prev, status: 'stopped' as TaskStatus, updated_at: nowIso }
        : prev
    ))

    if (isDbReady) {
      dbUpdateTask(taskId, { status: 'stopped' }).catch(console.error)
    }
  }, [stopAgent, taskId, isDbReady, dbUpdateTask])

  // Recover pending permission/question requests on task/session change.
  useEffect(() => {
    if (!taskId) return
    if (
      currentTask?.status === 'completed' ||
      currentTask?.status === 'error' ||
      currentTask?.status === 'stopped'
    ) {
      return
    }
    refreshPendingRequests(taskId).catch((err) => {
      console.error('[TaskDetail] Failed to refresh pending requests:', err)
    })
    refreshTurnRuntime(taskId).catch((err) => {
      console.error('[TaskDetail] Failed to refresh turn runtime:', err)
    })
  }, [taskId, currentRunId, currentTask?.status, refreshPendingRequests, refreshTurnRuntime])

  const handleCreateScheduledTask = useCallback(() => {
    if (isRunning) {
      moveToBackground()
    }
    navigate('/scheduled-tasks', {
      state: {
        sourcePrompt: currentTask?.prompt || '',
        approvedPlan: currentPlan || executionPlan || undefined,
      },
    })
  }, [currentPlan, currentTask?.prompt, executionPlan, isRunning, moveToBackground, navigate])

  // Computed values
  const workingDir = useMemo(() => {
    const resolveDir = (filePath?: string) => {
      if (!filePath) return ''
      const normalized = filePath.replace(/\\/g, '/')
      const lastSlash = normalized.lastIndexOf('/')
      return lastSlash > 0 ? normalized.slice(0, lastSlash) : ''
    }

    const selectedDir = resolveDir(selectedArtifact?.path)
    if (selectedDir) return selectedDir

    for (const artifact of artifacts) {
      const dir = resolveDir(artifact.path)
      if (dir) return dir
    }

    return ''
  }, [selectedArtifact?.path, artifacts])

  const allRunningTaskIds = useMemo(() => {
    const ids = new Set(backgroundRunningIds)
    if (isRunning && taskId) ids.add(taskId)
    return Array.from(ids)
  }, [backgroundRunningIds, isRunning, taskId])

  const isViewingLatestTurn = turnsCount <= 1 || selectedTurnIndex === turnsCount - 1

  const taskErrorNotice = useMemo(() => getTaskErrorNotice(error, currentMessages), [error, currentMessages])
  const headerTitle = useMemo(
    () => getTurnHeaderTitle(visibleTurnMessages, currentTask?.title || '加载中...'),
    [visibleTurnMessages, currentTask?.title]
  )

  const handleOpenPreviewPanel = useCallback(() => {
    if (!selectedArtifact) return
    setRightOpen(true)
  }, [selectedArtifact, setRightOpen])

  const handleSelectedTurnMessagesChange = useCallback((
    messages: AgentMessage[],
    meta: {
      turnsCount: number
      selectedTurnIndex: number
      latestTurnIndex: number
      turnSummary: TurnStatusSummary | null
    }
  ) => {
    const wasViewingLatestBeforeUpdate =
      turnsCount <= 1 || selectedTurnIndex >= Math.max(0, turnsCount - 1)
    const hasNewTurn = meta.turnsCount > turnsCount
    if (hasNewTurn && wasViewingLatestBeforeUpdate) {
      const nextLatestIndex = Math.max(0, meta.latestTurnIndex)
      if (nextLatestIndex !== selectedTurnIndex) {
        setSelectedTurnIndex(nextLatestIndex)
        if (taskId) {
          setTaskTurnSelections((prev) => {
            if (prev[taskId] === nextLatestIndex) return prev
            return {
              ...prev,
              [taskId]: nextLatestIndex,
            }
          })
        }
      }
    }

    setTurnsCount((prev) => (prev === meta.turnsCount ? prev : meta.turnsCount))
    setSelectedTurnMessages((prev) => {
      if (prev.length === messages.length && prev.every((msg, index) => msg.id === messages[index]?.id)) {
        return prev
      }
      return messages
    })
  }, [selectedTurnIndex, turnsCount, taskId])

  const handleSelectedTurnIndexChange = useCallback((index: number) => {
    const normalizedIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0
    setSelectedTurnIndex(normalizedIndex)
    if (!taskId) return
    setTaskTurnSelections((prev) => {
      if (prev[taskId] === normalizedIndex) {
        return prev
      }
      return {
        ...prev,
        [taskId]: normalizedIndex,
      }
    })
  }, [taskId])

  // ========== RENDER ==========

  return (
    <div className="ew-shell flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        currentTaskId={taskId}
        onSelectTask={handleSelectTask}
        onNewTask={handleNewTask}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={allRunningTaskIds}
        isCollapsed={!isLeftOpen}
        onToggleCollapse={toggleLeft}
      />

      {/* Main Content */}
      <div className="ew-main-panel my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-[1.5rem]">
        {/* Chat Panel */}
        <div
          className={cn(
            'flex min-w-0 flex-col overflow-hidden transition-all duration-200',
            !isRightSidebarVisible && 'rounded-2xl',
            isRightSidebarVisible && 'rounded-l-2xl'
          )}
          style={{ flex: '1 1 0%', minWidth: '320px' }}
        >
          {/* Header */}
          <header className="z-10 flex shrink-0 items-center gap-2 border-b border-[color:color-mix(in_oklab,var(--ui-border)_70%,transparent)] px-5 py-3.5">
            <button
              onClick={toggleLeft}
              className="ew-icon-btn flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors md:hidden"
            >
              <PanelLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1
                className="ew-title max-w-[min(50vw,36rem)] truncate text-sm font-medium"
                title={headerTitle}
              >
                {headerTitle}
              </h1>
            </div>
            <button
              onClick={handleCreateScheduledTask}
              className="ew-icon-btn inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
              title="保存为定时任务"
            >
              <CalendarClock className="size-4" />
              <span className="hidden md:inline">定时任务</span>
            </button>
            <button
              onClick={() => setRightOpen(!isRightSidebarVisible)}
              className={cn(
                'ew-icon-btn flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors',
                isRightSidebarVisible && 'ew-highlight'
              )}
              title={isRightSidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
            >
              <PanelLeft className="size-4 rotate-180" />
            </button>
          </header>

          {/* Messages Area */}
          <div
            ref={messagesContainerRef}
            className={cn(
              'relative flex-1 overflow-x-hidden overflow-y-auto',
              !isRightSidebarVisible && 'flex justify-center'
            )}
          >
            <div className={cn('w-full px-6 pt-5 pb-24', !isRightSidebarVisible && 'max-w-[1280px]')}>
              {isLoading ? (
                <div className="flex min-h-[200px] items-center justify-center py-12">
                  <div className="ew-subtext flex items-center gap-3">
                    <Loader2 className="size-5 animate-spin" />
                    <span>加载中...</span>
                  </div>
                </div>
              ) : (
                <div className="min-w-0 max-w-full space-y-4">
                  {taskErrorNotice && (
                    <div
                      data-tone={taskErrorNotice.tone}
                      className={cn(
                        'ew-task-notice rounded-xl px-4 py-3 text-sm'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <div className="space-y-1">
                          <p className="font-medium">{taskErrorNotice.title}</p>
                          <p className="text-xs opacity-90">{taskErrorNotice.detail}</p>
                          <p className="text-xs opacity-70">
                            错误码: {error?.code || 'UNKNOWN_ERROR'}
                            {turnId ? ` · 回合: ${turnId}` : ''}
                            {Number.isFinite(taskVersion) ? ` · 任务版本: ${taskVersion}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {currentPhase === 'blocked' && (
                    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium">当前回合等待前序回合结果</p>
                          <p className="text-xs text-yellow-100/80">
                            {blockedByTurnIds.length > 0
                              ? `依赖回合: ${blockedByTurnIds.join(', ')}`
                              : '依赖状态暂未就绪，请稍后重试。'}
                            {turnId ? ` · 当前回合: ${turnId}` : ''}
                            {turnState ? ` · 状态: ${turnState}` : ''}
                            {Number.isFinite(taskVersion) ? ` · 任务版本: ${taskVersion}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={handleResumeBlockedTurn}
                          className="inline-flex items-center rounded-lg bg-yellow-500/20 px-3 py-1.5 text-xs font-medium text-yellow-100 transition hover:bg-yellow-500/30"
                        >
                          重试当前回合
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Message list with plan approval and question */}
                  <TaskMessageList
                    messages={currentMessages}
                    isRunning={isCurrentTaskRunning}
                    hasPersistedTask={!!currentTask}
                    fileBaseDir={workingDir || undefined}
                    executionPlan={executionPlan}
                    isAwaitingApproval={currentPhase === 'awaiting_approval'}
                    isAwaitingClarification={currentPhase === 'awaiting_clarification'}
                    taskStatus={currentTask?.status}
                    latestApprovalTerminal={latestApprovalTerminal}
                    pendingPermission={pendingPermission}
                    pendingQuestion={pendingQuestion}
                    onSubmitPermission={handlePermissionResponse}
                    onSubmitQuestion={handleQuestionResponse}
                    approvalPlan={currentPlan}
                    onApprovePlan={handleApprovePlan}
                    onRejectPlan={handleRejectPlan}
                    canOpenPreview={!!selectedArtifact}
                    onOpenPreview={handleOpenPreviewPanel}
                    selectedTurnIndex={selectedTurnIndex}
                    onSelectedTurnIndexChange={handleSelectedTurnIndexChange}
                    onSelectedTurnMessagesChange={handleSelectedTurnMessagesChange}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Chat Input */}
          <div className={cn(
            'relative shrink-0 border-t border-[color:color-mix(in_oklab,var(--ui-border)_70%,transparent)]',
            !isRightSidebarVisible && 'flex justify-center'
          )}>
            {showScrollButton && (
              <button
                onClick={scrollToBottom}
                className="ew-control absolute -top-12 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center justify-center rounded-full p-2 shadow-lg transition-all"
                title="滚动到底部"
              >
                <ArrowDown className="size-4" />
              </button>
            )}
            <div className={cn('w-full px-4 py-3', !isRightSidebarVisible && 'max-w-[1280px]')}>
              <ChatInput
                placeholder={
                  currentPhase === 'awaiting_approval'
                    ? '请确认或拒绝执行计划...'
                    : currentPhase === 'awaiting_clarification'
                    ? '请先回答澄清问题...'
                    : currentPhase === 'blocked'
                    ? '当前回合等待依赖完成，可点击“重试当前回合”继续...'
                    : '输入消息...'
                }
                isRunning={isCurrentTaskRunning}
                disabled={currentPhase === 'awaiting_approval' || currentPhase === 'awaiting_clarification' || currentPhase === 'blocked'}
                disabledReason={
                  currentPhase === 'awaiting_approval'
                    ? '当前处于计划审批阶段，请先点击“开始执行”或“取消”。'
                    : currentPhase === 'awaiting_clarification'
                    ? '当前处于需求澄清阶段，请先提交澄清回答。'
                    : currentPhase === 'blocked'
                    ? '当前回合依赖前序回合结果，请先等待依赖完成后点击“重试当前回合”。'
                    : undefined
                }
                onSubmit={handleChatSubmit}
                onStop={handleStopAgent}
              />
            </div>
            </div>
          </div>

        {/* Divider */}
        <div
          className={cn(
            'ew-resize-handle relative shrink-0 transition-all duration-300',
            isRightSidebarVisible ? 'w-1 cursor-col-resize' : 'w-0'
          )}
          onPointerDown={isRightSidebarVisible ? handleRightResizeStart : undefined}
        >
          <div className="ew-divider absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
        </div>

        {/* Right Sidebar */}
        <div className={cn(
          'flex shrink-0 overflow-hidden rounded-r-[1.5rem] transition-all duration-300',
        )}
        style={{ width: isRightSidebarVisible ? `${rightPanelWidth}px` : '0px' }}>
          <RightSidebar
            messages={visibleTurnMessages}
            isRunning={isCurrentTaskRunning}
            artifacts={artifacts}
            selectedArtifact={selectedArtifact}
            onSelectArtifact={setSelectedArtifact}
            workingDir={workingDir}
            isVisible={isRightSidebarVisible}
            taskId={taskId}
          />
        </div>
      </div>
    </div>
  )
}

export function TaskDetailPage() {
  return <TaskDetailContent />
}
