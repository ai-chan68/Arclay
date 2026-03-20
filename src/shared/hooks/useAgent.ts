/**
 * useAgent hook - 管理 Agent 状态和 SSE 流式通信
 *
 * 工作流位置：
 *   用户输入 → TaskDetailPage → **useAgent** → API /api/v2/agent → SSE → 实时消息更新
 *
 * 职责：
 * - 发送 prompt 到 API
 * - 解析 SSE 流并更新消息列表
 * - 合并连续的 assistant text 消息
 * - 通过 onMessageReceived 回调支持消息持久化
 * - 支持多任务并发：当前任务可移到后台继续执行
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { AgentMessage, AgentError, Plan } from '@shared-types'
import { getApiUrl } from '../api'
import {
  addBackgroundTask,
  removeBackgroundTask,
  updateBackgroundTaskStatus,
  updateBackgroundTaskMessages,
  getBackgroundTask,
} from '../lib/background-tasks'

/**
 * 后台任务流读取器 - 独立于 UI 继续读取 SSE 流
 */
interface BackgroundStreamReader {
  taskId: string
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  buffer: string
  messages: AgentMessage[]
  onMessage: (message: AgentMessage) => Promise<void>
  onComplete: (messages: AgentMessage[]) => void
  isActive: boolean
}

// 全局后台读取器映射
const backgroundReaders = new Map<string, BackgroundStreamReader>()

/**
 * 解析 SSE 行
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
 * 启动后台流读取
 */
async function startBackgroundReading(
  taskId: string,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialMessages: AgentMessage[],
  onMessage: (message: AgentMessage) => Promise<void>,
  onComplete: (messages: AgentMessage[]) => void
): Promise<void> {
  const bgReader: BackgroundStreamReader = {
    taskId,
    reader,
    decoder: new TextDecoder(),
    buffer: '',
    messages: [...initialMessages],
    onMessage,
    onComplete,
    isActive: true,
  }

  backgroundReaders.set(taskId, bgReader)

  try {
    while (bgReader.isActive) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('[BackgroundReader] Stream completed for task:', taskId)
        break
      }

      bgReader.buffer += bgReader.decoder.decode(value, { stream: true })
      const lines = bgReader.buffer.split('\n')
      bgReader.buffer = lines.pop() || ''

      for (const line of lines) {
        const parsed = parseEvent(line)
        if (!parsed) continue

        if (parsed.data) {
          try {
            const message: AgentMessage = JSON.parse(parsed.data)

            if (message.type === 'text') {
              message.role = 'assistant'
            }

            // Add message (except session type)
            // 不再合并消息，每条消息独立存储
            if (message.type !== 'session') {
              bgReader.messages.push(message)

              // Call message callback (async)
              await bgReader.onMessage(message)
            }
          } catch {
            // Skip unparseable data
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.log('[BackgroundReader] Stream aborted for task:', taskId)
    } else {
      console.error('[BackgroundReader] Error for task:', taskId, err)
    }
  } finally {
    bgReader.isActive = false
    backgroundReaders.delete(taskId)
    bgReader.onComplete(bgReader.messages)
    updateBackgroundTaskStatus(taskId, false)
  }
}

/**
 * 停止后台流读取
 */
function stopBackgroundReading(taskId: string): void {
  const bgReader = backgroundReaders.get(taskId)
  if (bgReader) {
    bgReader.isActive = false
    bgReader.reader.cancel()
    backgroundReaders.delete(taskId)
  }
}

export interface UseAgentState {
  messages: AgentMessage[]
  isRunning: boolean
  error: AgentError | null
  sessionId: string | null
  pendingPlan: Plan | null
}

export interface UseAgentActions {
  run: (prompt: string, options?: { taskId?: string }) => Promise<void>
  abort: () => void
  clear: () => void
  approvePlan: () => void
  rejectPlan: () => void
}

export type UseAgentReturn = UseAgentState & UseAgentActions

export interface UseAgentOptions {
  autoClearOnError?: boolean
  maxMessages?: number
  externalMessages?: AgentMessage[]
  onMessagesChange?: (messages: AgentMessage[]) => void
  externalSessionId?: string | null
  onSessionIdChange?: (sessionId: string | null) => void
  /**
   * 每条 SSE 消息到达时触发，用于消息持久化到 SQLite/IndexedDB。
   * 支持 taskId 参数，用于后台任务持久化时使用正确的 taskId。
   * 返回 Promise 以支持 await 持久化。
   */
  onMessageReceived?: (message: AgentMessage, taskId?: string) => Promise<void>
  /**
   * 执行完成时触发（包括正常完成和错误）
   */
  onRunComplete?: (messages: AgentMessage[]) => void
  /**
   * 当前任务 ID（用于后台任务管理）
   */
  taskId?: string
  /**
   * 当前任务标题（用于后台任务显示）
   */
  taskTitle?: string
  /**
   * 当前任务状态（用于后台任务管理）
   */
  taskStatus?: string
  /**
   * 任务切换前的回调，用于将当前任务移到后台
   */
  onMoveToBackground?: (taskId: string, messages: AgentMessage[], abortController: AbortController) => void
}

export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const {
    autoClearOnError = false,
    maxMessages = 1000,
    externalMessages,
    onMessagesChange,
    externalSessionId,
    onSessionIdChange,
    onMessageReceived,
    onRunComplete,
    taskId,
    taskTitle,
    taskStatus,
    onMoveToBackground,
  } = options

  const [internalMessages, setInternalMessages] = useState<AgentMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<AgentError | null>(null)
  const [internalSessionId, setInternalSessionId] = useState<string | null>(null)
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null)

  const messages = externalMessages !== undefined ? externalMessages : internalMessages
  const sessionId = externalSessionId !== undefined ? externalSessionId : internalSessionId

  // 稳定引用，避免回调变化导致重渲染
  const onMessageReceivedRef = useRef(onMessageReceived)
  const onRunCompleteRef = useRef(onRunComplete)
  const onMoveToBackgroundRef = useRef(onMoveToBackground)
  useEffect(() => { onMessageReceivedRef.current = onMessageReceived }, [onMessageReceived])
  useEffect(() => { onRunCompleteRef.current = onRunComplete }, [onRunComplete])
  useEffect(() => { onMoveToBackgroundRef.current = onMoveToBackground }, [onMoveToBackground])

  // 用 ref 跟踪最新 messages，防止 updateMessages 闭包中读到陈旧值
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // 用 ref 跟踪 isRunning 状态
  const isRunningRef = useRef(isRunning)
  isRunningRef.current = isRunning

  // 用 ref 跟踪当前任务信息
  const taskIdRef = useRef(taskId)
  const taskTitleRef = useRef(taskTitle)
  const taskStatusRef = useRef(taskStatus)
  const sessionIdRef = useRef(sessionId)
  taskIdRef.current = taskId
  taskTitleRef.current = taskTitle
  taskStatusRef.current = taskStatus
  sessionIdRef.current = sessionId

  const updateMessages = useCallback((newMessages: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[])) => {
    if (typeof newMessages === 'function') {
      // 使用 messagesRef.current 获取最新消息，避免闭包中的 externalMessages 过期
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

  const abortControllerRef = useRef<AbortController | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  const parseEvent = (line: string): { event: string; data: string } | null => {
    if (line.startsWith('event:')) {
      return { event: line.slice(6).trim(), data: '' }
    }
    if (line.startsWith('data:')) {
      return { event: '', data: line.slice(5).trim() }
    }
    return null
  }

  const run = useCallback(async (prompt: string, options?: { taskId?: string }) => {
    // 使用传入的 taskId 或 fallback 到 ref 中的值
    const effectiveTaskId = options?.taskId ?? taskIdRef.current
    console.log('[useAgent] run called:', { prompt: prompt.slice(0, 50), isRunning, sessionId, effectiveTaskId })

    // 如果当前有任务正在运行，将其移到后台继续执行
    if (isRunningRef.current && readerRef.current && taskIdRef.current) {
      console.log('[useAgent] Moving current task to background before starting new:', taskIdRef.current)

      const currentReader = readerRef.current
      const currentMessages = [...messagesRef.current]
      const backgroundTaskId = taskIdRef.current

      // 添加到后台任务列表
      addBackgroundTask({
        taskId: backgroundTaskId,
        sessionId: sessionIdRef.current || '',
        prompt: prompt,
        title: taskTitleRef.current || '后台任务',
        status: (taskStatusRef.current || 'running') as any,
        isRunning: true,
        messages: currentMessages,
        abortController: abortControllerRef.current || new AbortController(),
      })

      // 启动后台流读取（独立于 UI 继续读取 SSE 流）
      startBackgroundReading(
        backgroundTaskId,
        currentReader,
        currentMessages,
        async (message) => {
          // 后台消息回调 - 持久化到数据库
          // 使用后台任务的 taskId，不依赖 ref
          await onMessageReceivedRef.current?.(message, backgroundTaskId)
          // 更新后台任务的消息列表
          const bgTask = getBackgroundTask(backgroundTaskId)
          if (bgTask) {
            updateBackgroundTaskMessages(backgroundTaskId, [...bgTask.messages, message])
          }
        },
        (messages) => {
          // 后台完成回调
          console.log('[BackgroundReader] Task completed:', backgroundTaskId)
          onRunCompleteRef.current?.(messages)
        }
      )

      // 通知外部（如果有回调）
      if (onMoveToBackgroundRef.current && abortControllerRef.current) {
        onMoveToBackgroundRef.current(
          backgroundTaskId,
          currentMessages,
          abortControllerRef.current
        )
      }

      // 清除 refs - 后台读取器已接管流
      abortControllerRef.current = null
      readerRef.current = null

      // 重置 UI 状态，准备新任务
      setIsRunning(false)
    }

    console.log('[useAgent] Starting run...')
    setError(null)
    setIsRunning(true)

    const userMessage: AgentMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: 'text',
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }
    updateMessages(prev => [...prev, userMessage])
    // 先持久化用户消息 - 使用 effectiveTaskId 确保消息保存到正确的任务
    console.log('[useAgent] Saving user message with taskId:', effectiveTaskId)
    await onMessageReceivedRef.current?.(userMessage, effectiveTaskId ?? undefined)
    console.log('[useAgent] User message saved')

    abortControllerRef.current = new AbortController()

    // 收集本次运行的所有消息（用于 onRunComplete）
    const runMessages: AgentMessage[] = [userMessage]

    try {
      const apiUrl = await getApiUrl('/api/v2/agent')
      console.log('[useAgent] Making API request to:', apiUrl)

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, sessionId }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const parsed = parseEvent(line)
          if (!parsed) continue

          if (parsed.event) {
            // event line - skip, we parse type from data
          } else if (parsed.data) {
            try {
              const message: AgentMessage = JSON.parse(parsed.data)

              if (message.type === 'text') {
                message.role = 'assistant'
              }

              if (message.type === 'session' && message.sessionId) {
                updateSessionId(message.sessionId)
              }

              if (message.type === 'plan' && message.plan) {
                setPendingPlan(message.plan as Plan)
              }

              if (message.type === 'error') {
                setError({
                  code: 'PROVIDER_ERROR',
                  message: message.errorMessage || 'Unknown error',
                })
              }

              // Add message to list (except session type)
              // Note: 'done' type is needed for status detection in RightSidebar
              // 不再合并消息，每条消息独立存储，显示时由 MessageList 组件动态合并
              if (message.type !== 'session') {
                // 先持久化，再更新 UI - 使用 effectiveTaskId 确保消息保存到正确的任务
                console.log('[useAgent] Saving SSE message:', message.type, 'with taskId:', effectiveTaskId)
                await onMessageReceivedRef.current?.(message, effectiveTaskId ?? undefined)
                console.log('[useAgent] SSE message saved:', message.type)

                updateMessages(prev => {
                  const newMessages = [...prev, message]
                  return newMessages.length > maxMessages
                    ? newMessages.slice(-maxMessages)
                    : newMessages
                })

                runMessages.push(message)
              }
            } catch {
              // Skip unparseable data
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('[useAgent] Error:', errorMessage)
      setError({ code: 'NETWORK_ERROR', message: errorMessage })

      if (autoClearOnError) {
        updateMessages([])
      }
    } finally {
      setIsRunning(false)
      abortControllerRef.current = null
      readerRef.current = null
      onRunCompleteRef.current?.(runMessages)
    }
  }, [sessionId, autoClearOnError, maxMessages, updateMessages])

  const abort = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    try {
      if (sessionId) {
        const apiUrl = await getApiUrl(`/api/v2/agent/stop/${sessionId}`)
        await fetch(apiUrl, { method: 'POST' })
      }
    } catch {
      // Ignore abort errors
    }

    setIsRunning(false)
  }, [sessionId])

  const clear = useCallback(() => {
    updateMessages([])
    setError(null)
    updateSessionId(null)
    setPendingPlan(null)
  }, [updateMessages, updateSessionId])

  const approvePlan = useCallback(() => {
    setPendingPlan(null as unknown as Plan)
  }, [])

  const rejectPlan = useCallback(() => {
    setPendingPlan(null as unknown as Plan)
  }, [])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (readerRef.current) {
        readerRef.current.cancel()
      }
    }
  }, [])

  return {
    messages,
    isRunning,
    error,
    sessionId,
    pendingPlan,
    run,
    abort,
    clear,
    approvePlan,
    rejectPlan,
  }
}
