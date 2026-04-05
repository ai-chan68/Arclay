/**
 * Knowledge Note types for user-defined context injection
 */

export type KnowledgeNoteType = 'context' | 'instruction' | 'reference'

export type KnowledgeNoteScope = 'global' | 'project' | 'task'

export interface KnowledgeNote {
  id: string
  type: KnowledgeNoteType
  title: string
  content: string
  enabled: boolean
  scope: KnowledgeNoteScope
  createdAt: string
  updatedAt: string
  tags?: string[]
  taskId?: string  // Only for task-scoped notes
}

export interface CreateKnowledgeNoteInput {
  type: KnowledgeNoteType
  title: string
  content: string
  enabled?: boolean
  scope: KnowledgeNoteScope
  tags?: string[]
  taskId?: string
}

export interface UpdateKnowledgeNoteInput {
  title?: string
  content?: string
  enabled?: boolean
  tags?: string[]
}
