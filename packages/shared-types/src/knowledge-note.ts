/**
 * Knowledge Note types for user-defined context injection
 */

export type KnowledgeNoteType = 'context' | 'instruction' | 'reference'

export type KnowledgeNoteScope = 'global'

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
}

export interface CreateKnowledgeNoteInput {
  type: KnowledgeNoteType
  title: string
  content: string
  enabled?: boolean
  scope: KnowledgeNoteScope
  tags?: string[]
}

export interface UpdateKnowledgeNoteInput {
  title?: string
  content?: string
  enabled?: boolean
  tags?: string[]
}
