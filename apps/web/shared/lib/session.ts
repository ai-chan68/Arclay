/**
 * Session utilities for task management
 * Provides consistent ID generation using a shared pattern
 */

import { nanoid } from 'nanoid'

/**
 * Generate a session ID with format: YYYYMMDDHHmmss_slug
 * Example: 20260219143052_abc123
 */
export function generateSessionId(): string {
  const now = new Date()
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  const slug = nanoid(6)
  return `${dateStr}_${slug}`
}

/**
 * Generate a task ID with format: {sessionId}-task-{index}
 * Example: 20260219143052_abc123-task-01
 */
export function generateTaskId(sessionId: string, taskIndex: number): string {
  const indexStr = String(taskIndex).padStart(2, '0')
  return `${sessionId}-task-${indexStr}`
}

/**
 * Extract session ID from task ID
 */
export function extractSessionId(taskId: string): string | null {
  const match = taskId.match(/^(.+)-task-\d+$/)
  return match ? match[1] : null
}

/**
 * Extract task index from task ID
 */
export function extractTaskIndex(taskId: string): number | null {
  const match = taskId.match(/-task-(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Session info for task creation
 */
export interface SessionInfo {
  sessionId: string
  taskIndex: number
}

/**
 * Create session info for a new session
 */
export function createSessionInfo(): SessionInfo {
  return {
    sessionId: generateSessionId(),
    taskIndex: 1,
  }
}

/**
 * Increment task index for follow-up tasks
 */
export function incrementTaskIndex(sessionInfo: SessionInfo): SessionInfo {
  return {
    ...sessionInfo,
    taskIndex: sessionInfo.taskIndex + 1,
  }
}
