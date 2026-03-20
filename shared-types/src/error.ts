/**
 * Agent error types
 */

/**
 * Error codes for agent operations
 */
export type AgentErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR'
  | 'TOOL_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'EXECUTION_ABORTED'
  | 'EXECUTION_ERROR'
  | 'CONTINUE_ERROR'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_STATE_CONFLICT'
  | 'TURN_NOT_FOUND'
  | 'TURN_STATE_CONFLICT'
  | 'TURN_VERSION_CONFLICT'
  | 'TURN_BLOCKED'
  | 'UNKNOWN_ERROR'

/**
 * Structured error from agent operations
 */
export interface AgentError {
  code: AgentErrorCode
  message: string
  details?: Record<string, unknown>
  retryable?: boolean
}

/**
 * Factory function to create agent errors
 */
export function createAgentError(
  code: AgentErrorCode,
  message: string,
  details?: Record<string, unknown>
): AgentError {
  const retryable = ['RATE_LIMITED', 'NETWORK_ERROR', 'TIMEOUT'].includes(code)
  return { code, message, details, retryable }
}

/**
 * Type guard to check if an object is an AgentError
 */
export function isAgentError(error: unknown): error is AgentError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  )
}
