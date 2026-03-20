/**
 * useDatabase hook - 封装数据库操作
 * 根据运行环境自动选择 SQLite (Tauri) 或 IndexedDB (browser)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Message,
  AgentMessage,
  CreateSessionInput,
  CreateMessageInput,
  MessageType,
} from '@shared-types'
import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  getAllSessions as dbGetAllSessions,
  createTask as dbCreateTask,
  getTask as dbGetTask,
  getAllTasks as dbGetAllTasks,
  updateTask as dbUpdateTask,
  deleteTask as dbDeleteTask,
  createMessage as dbCreateMessage,
  getMessagesByTaskId as dbGetMessagesByTaskId,
  countMessagesByTaskId as dbCountMessagesByTaskId,
  deleteMessagesByTaskId as dbDeleteMessagesByTaskId,
} from '../db'

interface UseDatabaseReturn {
  isReady: boolean

  // Task operations
  loadAllTasks: () => Promise<Task[]>
  createTask: (input: CreateTaskInput) => Promise<Task>
  updateTask: (id: string, data: UpdateTaskInput) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  getTask: (id: string) => Promise<Task | null>

  // Message operations
  loadMessages: (taskId: string) => Promise<Message[]>
  countMessages: (taskId: string) => Promise<number>
  saveMessage: (taskId: string, message: AgentMessage) => Promise<void>
  saveMessages: (taskId: string, messages: AgentMessage[]) => Promise<void>

  // Session operations
  listSessions: () => Promise<{ id: string; prompt: string; task_count: number }[]>
}

/**
 * AgentMessage → DB Message 转换
 * Note: 'session' type is skipped (not saved to DB)
 */
function agentMessageToDbMessage(msg: AgentMessage): Omit<CreateMessageInput, 'task_id'> {
  // Map AgentMessage type to DB MessageType (excluding 'session')
  // Use 'user' type for user messages to preserve role information
  let type: MessageType
  if (msg.type === 'session') {
    type = 'text'
  } else if (msg.type === 'user' || msg.role === 'user') {
    type = 'user'
  } else {
    type = msg.type as MessageType
  }

  return {
    type,
    content: msg.content ?? undefined,
    tool_name: msg.toolName ?? undefined,
    tool_input:
      msg.type === 'plan' && msg.plan
        ? JSON.stringify({ __plan: msg.plan })
        : msg.toolInput
          ? JSON.stringify(msg.toolInput)
          : undefined,
    tool_output: msg.toolOutput ?? undefined,
    tool_use_id: msg.toolUseId ?? undefined,
    subtype: msg.role ?? undefined, // Store role in subtype field
    error_message: msg.errorMessage ?? undefined,
    attachments: msg.attachments ? JSON.stringify(msg.attachments) : undefined,
  }
}

/**
 * DB Message → AgentMessage 转换
 */
function dbMessageToAgentMessage(msg: Message): AgentMessage {
  let toolInput: Record<string, unknown> | undefined
  let plan: AgentMessage['plan']
  if (msg.tool_input) {
    try {
      const parsed = JSON.parse(msg.tool_input) as Record<string, unknown>
      if (msg.type === 'plan' && parsed && typeof parsed === 'object' && '__plan' in parsed) {
        plan = parsed.__plan as AgentMessage['plan']
      } else {
        toolInput = parsed
      }
    } catch {
      toolInput = undefined
    }
  }

  // Restore role from subtype or infer from type
  const role: AgentMessage['role'] = msg.subtype as AgentMessage['role'] ||
    (msg.type === 'user' ? 'user' : 'assistant')

  // Parse attachments if present
  let attachments: AgentMessage['attachments']
  if (msg.attachments) {
    try {
      attachments = JSON.parse(msg.attachments)
    } catch {
      attachments = undefined
    }
  }

  return {
    id: String(msg.id),
    type: msg.type as AgentMessage['type'],
    role,
    content: msg.content ?? undefined,
    toolName: msg.tool_name ?? undefined,
    toolInput,
    toolOutput: msg.tool_output ?? undefined,
    toolUseId: msg.tool_use_id ?? undefined,
    errorMessage: msg.error_message ?? undefined,
    timestamp: new Date(msg.created_at).getTime(),
    attachments,
    plan,
  }
}

export function useDatabase(): UseDatabaseReturn {
  const [isReady, setIsReady] = useState(false)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    // Database is ready immediately since we're using direct function calls
    setIsReady(true)
  }, [])

  const loadAllTasks = useCallback(async (): Promise<Task[]> => {
    try {
      console.log('[useDatabase] loadAllTasks: Loading all tasks...')
      const tasks = await dbGetAllTasks()
      console.log('[useDatabase] loadAllTasks: Total tasks loaded:', tasks.length)
      return tasks
    } catch (error) {
      console.error('[useDatabase] Failed to load tasks:', error)
      return []
    }
  }, [])

  const createTask = useCallback(async (input: CreateTaskInput): Promise<Task> => {
    console.log('[useDatabase] createTask: Creating task:', input)

    // Ensure session exists with the same session_id
    const existingSession = await dbGetSession(input.session_id)
    console.log('[useDatabase] createTask: Existing session:', existingSession ? 'found' : 'not found')

    if (!existingSession) {
      console.log('[useDatabase] createTask: Creating new session with id:', input.session_id)
      // Use the same session_id from input to ensure consistency
      const sessionInput: CreateSessionInput = {
        id: input.session_id,
        prompt: input.prompt,
      }
      await dbCreateSession(sessionInput)
    }

    const task = await dbCreateTask(input)
    console.log('[useDatabase] createTask: Task created:', task)
    return task
  }, [])

  const updateTask = useCallback(async (id: string, data: UpdateTaskInput): Promise<void> => {
    try {
      await dbUpdateTask(id, data)
    } catch (error) {
      console.error('[useDatabase] Failed to update task:', error)
    }
  }, [])

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    try {
      await dbDeleteTask(id)
    } catch (error) {
      console.error('[useDatabase] Failed to delete task:', error)
    }
  }, [])

  const getTask = useCallback(async (id: string): Promise<Task | null> => {
    try {
      return await dbGetTask(id)
    } catch (error) {
      console.error('[useDatabase] Failed to get task:', error)
      return null
    }
  }, [])

  const loadMessages = useCallback(async (taskId: string): Promise<Message[]> => {
    try {
      return await dbGetMessagesByTaskId(taskId)
    } catch (error) {
      console.error('[useDatabase] Failed to load messages:', error)
      return []
    }
  }, [])

  const countMessages = useCallback(async (taskId: string): Promise<number> => {
    try {
      return await dbCountMessagesByTaskId(taskId)
    } catch (error) {
      console.error('[useDatabase] Failed to count messages:', error)
      return 0
    }
  }, [])

  const saveMessage = useCallback(async (taskId: string, message: AgentMessage): Promise<void> => {
    console.log('[useDatabase] saveMessage called:', { taskId, messageType: message.type })
    // Skip session messages (metadata only); keep done messages for status detection
    if (message.type === 'session') {
      console.log('[useDatabase] Skipping session message')
      return
    }
    try {
      const dbMessage = agentMessageToDbMessage(message)
      await dbCreateMessage({
        task_id: taskId,
        ...dbMessage,
      })
      console.log('[useDatabase] Message saved successfully:', message.type)
    } catch (error) {
      console.error('[useDatabase] Failed to save message:', error)
    }
  }, [])

  const saveMessages = useCallback(async (taskId: string, messages: AgentMessage[]): Promise<void> => {
    for (const msg of messages) {
      if (msg.type === 'session') continue
      try {
        const dbMessage = agentMessageToDbMessage(msg)
        await dbCreateMessage({
          task_id: taskId,
          ...dbMessage,
        })
      } catch (error) {
        console.error('[useDatabase] Failed to save message:', error)
      }
    }
  }, [])

  const listSessions = useCallback(async () => {
    try {
      const sessions = await dbGetAllSessions()
      return sessions.map(s => ({
        id: s.id,
        prompt: s.prompt,
        task_count: s.task_count,
      }))
    } catch (error) {
      console.error('[useDatabase] Failed to list sessions:', error)
      return []
    }
  }, [])

  return {
    isReady,
    loadAllTasks,
    createTask,
    updateTask,
    deleteTask,
    getTask,
    loadMessages,
    countMessages,
    saveMessage,
    saveMessages,
    listSessions,
  }
}

export { dbMessageToAgentMessage, agentMessageToDbMessage }
