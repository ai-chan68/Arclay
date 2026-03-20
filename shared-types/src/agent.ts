/**
 * Agent message types for communication between frontend and backend
 */

export type AgentMessageType =
  | 'session'      // Session information
  | 'text'         // Text message
  | 'tool_use'     // Tool call
  | 'tool_result'  // Tool result
  | 'result'       // Execution result
  | 'error'        // Error message
  | 'done'         // Completion marker
  | 'plan'         // Plan message
  | 'direct_answer' // Direct answer
  | 'user'         // User message
  | 'permission_request' // Permission request
  | 'clarification_request' // Clarification request
  | 'turn_state'; // Turn lifecycle snapshot

export type MessageRole = 'user' | 'assistant' | 'system';

export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  role?: MessageRole;  // Who sent this message
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolUseId?: string;
  errorMessage?: string;
  timestamp: number;
  // Plan fields (supports both old Plan and new TaskPlan)
  plan?: Plan | TaskPlan;
  // Session fields
  sessionId?: string;
  // UI fields
  isTemporary?: boolean;  // Marks temporary messages that will be replaced
  // Permission request fields
  permission?: PermissionRequest;
  // Legacy question fields
  question?: PendingQuestion;
  // Clarification request fields
  clarification?: PendingQuestion;
  // Turn runtime fields
  turn?: AgentTurnSnapshot;
  // Attachments
  attachments?: MessageAttachment[];
}

export type AgentTurnState =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_clarification'
  | 'executing'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentTurnSnapshot {
  taskId: string
  turnId: string
  state: AgentTurnState
  taskVersion: number
  readVersion: number
  writeVersion?: number | null
  blockedByTurnIds?: string[]
  reason?: string | null
}

/**
 * Permission request for user approval
 */
export interface PermissionRequest {
  id: string;
  type: 'file_write' | 'file_delete' | 'command_exec' | 'network_access' | 'other';
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * Pending question for user input
 */
export interface PendingQuestion {
  id: string;
  question: string;
  options?: string[];
  allowFreeText?: boolean;
  source?: 'clarification' | 'runtime_tool_question';
  round?: number;
}

/**
 * Message attachment
 */
export interface MessageAttachment {
  id: string;
  name: string;
  type: string;
  data: string; // base64 encoded
  size: number;
}

/**
 * Session status values
 */
export type SessionStatus = 'idle' | 'running' | 'completed' | 'error'

/**
 * Agent session info (from database)
 */
export interface AgentSessionInfo {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  messageCount: number;
}

/**
 * Plan step for structured task planning
 */
export interface AgentPlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}

/**
 * Plan structure for approval workflow
 */
export interface Plan {
  id: string;
  steps: AgentPlanStep[];
  summary: string;
}

export interface AgentStatus {
  isRunning: boolean;
  phase: AgentPhase;
  sessionId: string | null;
  taskId: string | null;
}

export type AgentPhase = 'idle' | 'planning' | 'awaiting_approval' | 'awaiting_clarification' | 'executing' | 'blocked';

/**
 * Task plan for approval workflow (easywork style)
 */
export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  notes?: string;
  createdAt: Date;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}
