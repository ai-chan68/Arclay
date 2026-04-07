/**
 * useMultiAgent hook - manages multi-agent execution state and streaming
 *
 * Extends useAgent functionality for parallel task execution
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  MultiAgentStatus,
  MultiAgentMessage,
  MultiAgentConfig,
  TaskAnalysis,
  SubTask,
  SubTaskResult,
  MultiAgentCost,
  AgentError
} from '@shared-types'
import { getApiUrl } from '../api'

/**
 * Multi-agent hook state
 */
export interface UseMultiAgentState {
  status: MultiAgentStatus | null
  isRunning: boolean
  error: AgentError | null
  executionId: string | null
  result: string | null
  cost: MultiAgentCost | null
  analysis: TaskAnalysis | null
  subtasks: SubTask[]
  subtaskResults: Map<string, SubTaskResult>
}

/**
 * Multi-agent hook actions
 */
export interface UseMultiAgentActions {
  runMultiAgent: (prompt: string, config?: Partial<MultiAgentConfig>) => Promise<void>
  previewDecomposition: (prompt: string) => Promise<TaskAnalysis | null>
  abort: () => void
  retrySubtask: (subtaskId: string) => Promise<void>
  skipSubtask: (subtaskId: string) => void
  getSubtaskResult: (subtaskId: string) => SubTaskResult | undefined
  clear: () => void
}

/**
 * Hook return type
 */
export type UseMultiAgentReturn = UseMultiAgentState & UseMultiAgentActions

/**
 * Options for useMultiAgent hook
 */
export interface UseMultiAgentOptions {
  defaultConfig?: Partial<MultiAgentConfig>
  autoPreview?: boolean
}

/**
 * useMultiAgent hook implementation
 */
export function useMultiAgent(options: UseMultiAgentOptions = {}): UseMultiAgentReturn {
  const { defaultConfig = {}, autoPreview = false } = options

  // State
  const [status, setStatus] = useState<MultiAgentStatus | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<AgentError | null>(null)
  const [executionId, setExecutionId] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [cost, setCost] = useState<MultiAgentCost | null>(null)
  const [analysis, setAnalysis] = useState<TaskAnalysis | null>(null)
  const [subtasks, setSubtasks] = useState<SubTask[]>([])
  const [subtaskResults, setSubtaskResults] = useState<Map<string, SubTaskResult>>(new Map())

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  /**
   * Parse SSE event from buffer
   */
  const parseEvent = (line: string): { event: string; data: string } | null => {
    if (line.startsWith('event:')) {
      return { event: line.slice(6).trim(), data: '' }
    }
    if (line.startsWith('data:')) {
      return { event: '', data: line.slice(5).trim() }
    }
    return null
  }

  /**
   * Run multi-agent execution
   */
  const runMultiAgent = useCallback(async (
    prompt: string,
    config?: Partial<MultiAgentConfig>
  ) => {
    if (isRunning) {
      console.warn('Multi-agent is already running')
      return
    }

    // Clear previous state
    setError(null)
    setResult(null)
    setCost(null)
    setIsRunning(true)

    // Create abort controller
    abortControllerRef.current = new AbortController()

    try {
      const apiUrl = await getApiUrl('/api/agent/multi/stream')
      console.log('[useMultiAgent] Calling API:', apiUrl)

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt,
          config: { ...defaultConfig, ...config }
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

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
            currentEvent = parsed.event
          } else if (parsed.data) {
            try {
              const message: MultiAgentMessage = JSON.parse(parsed.data)

              // Handle different message types
              switch (message.type) {
                case 'status':
                  if (message.phase) {
                    setStatus(prev => prev ? { ...prev, phase: message.phase! } : null)
                  }
                  if (message.subtask) {
                    setSubtaskResults(prev => {
                      const newMap = new Map(prev)
                      newMap.set(message.subtask!.id, {
                        subtaskId: message.subtask!.id,
                        status: message.subtask!.status
                      })
                      return newMap
                    })
                  }
                  break

                case 'subtask':
                  if (message.subtask) {
                    setSubtaskResults(prev => {
                      const newMap = new Map(prev)
                      newMap.set(message.subtask!.id, {
                        subtaskId: message.subtask!.id,
                        status: message.subtask!.status
                      })
                      return newMap
                    })
                  }
                  break

                case 'result':
                  if (message.result) {
                    setResult(message.result)
                  }
                  if (message.cost) {
                    setCost(message.cost)
                  }
                  setIsRunning(false)
                  break

                case 'error':
                  setError({
                    code: 'PROVIDER_ERROR',
                    message: message.error || 'Unknown error'
                  })
                  setIsRunning(false)
                  break

                case 'cost':
                  if (message.cost) {
                    setCost(message.cost)
                  }
                  break
              }
            } catch (e) {
              console.error('Failed to parse message:', parsed.data)
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Aborted - not an error
        return
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('[useMultiAgent] Error:', errorMessage)
      setError({
        code: 'NETWORK_ERROR',
        message: errorMessage
      })
    } finally {
      setIsRunning(false)
      abortControllerRef.current = null
      readerRef.current = null
    }
  }, [isRunning, defaultConfig])

  /**
   * Preview task decomposition without executing
   */
  const previewDecomposition = useCallback(async (prompt: string): Promise<TaskAnalysis | null> => {
    try {
      const apiUrl = await getApiUrl('/api/agent/multi/preview')
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error: ${response.status}`)
      }

      const data = await response.json()
      setAnalysis(data.analysis)
      return data.analysis
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('[useMultiAgent] Preview error:', errorMessage)
      setError({
        code: 'NETWORK_ERROR',
        message: errorMessage
      })
      return null
    }
  }, [])

  /**
   * Abort current execution
   */
  const abort = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Also notify server
    if (executionId) {
      try {
        const apiUrl = await getApiUrl(`/api/agent/multi/abort/${executionId}`)
        await fetch(apiUrl, { method: 'POST' })
      } catch {
        // Ignore abort errors
      }
    }

    setIsRunning(false)
  }, [executionId])

  /**
   * Retry a failed subtask
   */
  const retrySubtask = useCallback(async (subtaskId: string) => {
    // TODO: Implement subtask retry
    console.log('Retry subtask:', subtaskId)
  }, [])

  /**
   * Skip a subtask
   */
  const skipSubtask = useCallback((subtaskId: string) => {
    setSubtaskResults(prev => {
      const newMap = new Map(prev)
      const result = newMap.get(subtaskId)
      if (result) {
        newMap.set(subtaskId, { ...result, status: 'skipped' })
      }
      return newMap
    })
  }, [])

  /**
   * Get result for a specific subtask
   */
  const getSubtaskResult = useCallback((subtaskId: string): SubTaskResult | undefined => {
    return subtaskResults.get(subtaskId)
  }, [subtaskResults])

  /**
   * Clear all state
   */
  const clear = useCallback(() => {
    setStatus(null)
    setError(null)
    setResult(null)
    setCost(null)
    setAnalysis(null)
    setSubtasks([])
    setSubtaskResults(new Map())
    setExecutionId(null)
  }, [])

  /**
   * Cleanup on unmount
   */
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
    // State
    status,
    isRunning,
    error,
    executionId,
    result,
    cost,
    analysis,
    subtasks,
    subtaskResults,
    // Actions
    runMultiAgent,
    previewDecomposition,
    abort,
    retrySubtask,
    skipSubtask,
    getSubtaskResult,
    clear
  }
}
