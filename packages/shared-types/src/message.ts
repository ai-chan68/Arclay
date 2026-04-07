/**
 * Message types for chat/conversation history
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  path: string;
  size?: number;
}

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
  status: 'pending' | 'running' | 'completed' | 'error';
}
