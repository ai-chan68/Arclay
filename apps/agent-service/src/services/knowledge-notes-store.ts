/**
 * Knowledge Notes Store - 管理用户自定义上下文
 */

import { join } from 'path'
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import type { KnowledgeNote, CreateKnowledgeNoteInput, UpdateKnowledgeNoteInput, KnowledgeNoteScope } from '@shared-types'
import { randomUUID } from 'crypto'

export class KnowledgeNotesStore {
  private globalDir: string
  private projectDir: string

  constructor(globalDir: string, projectDir: string) {
    this.globalDir = globalDir
    this.projectDir = projectDir
  }

  private getScopeDir(scope: KnowledgeNoteScope, taskId?: string): string {
    if (scope === 'global') {
      return this.globalDir
    }
    if (scope === 'task' && taskId) {
      return join(this.projectDir, 'tasks', taskId)
    }
    return this.projectDir
  }

  private getNotePath(id: string, scope: KnowledgeNoteScope, taskId?: string): string {
    const dir = this.getScopeDir(scope, taskId)
    return join(dir, `${id}.json`)
  }

  async list(scope: KnowledgeNoteScope, taskId?: string): Promise<KnowledgeNote[]> {
    const dir = this.getScopeDir(scope, taskId)

    if (!existsSync(dir)) {
      return []
    }

    try {
      const files = await readdir(dir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))

      const notes: KnowledgeNote[] = []
      for (const file of jsonFiles) {
        try {
          const content = await readFile(join(dir, file), 'utf8')
          const note = JSON.parse(content) as KnowledgeNote
          notes.push(note)
        } catch {
          // Skip corrupted files
        }
      }

      return notes.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    } catch {
      return []
    }
  }

  async listEnabled(scope: KnowledgeNoteScope, taskId?: string): Promise<KnowledgeNote[]> {
    const all = await this.list(scope, taskId)
    return all.filter(note => note.enabled)
  }

  async get(id: string, scope: KnowledgeNoteScope, taskId?: string): Promise<KnowledgeNote | null> {
    const path = this.getNotePath(id, scope, taskId)

    if (!existsSync(path)) {
      return null
    }

    try {
      const content = await readFile(path, 'utf8')
      return JSON.parse(content) as KnowledgeNote
    } catch {
      return null
    }
  }

  async create(input: CreateKnowledgeNoteInput): Promise<KnowledgeNote> {
    const id = randomUUID()
    const now = new Date().toISOString()

    const note: KnowledgeNote = {
      id,
      type: input.type,
      title: input.title,
      content: input.content,
      enabled: input.enabled ?? true,
      scope: input.scope,
      createdAt: now,
      updatedAt: now,
      tags: input.tags,
      taskId: input.taskId,
    }

    const dir = this.getScopeDir(input.scope, input.taskId)
    await mkdir(dir, { recursive: true })

    const path = this.getNotePath(id, input.scope, input.taskId)
    await writeFile(path, JSON.stringify(note, null, 2), 'utf8')

    return note
  }

  async update(id: string, scope: KnowledgeNoteScope, updates: UpdateKnowledgeNoteInput, taskId?: string): Promise<KnowledgeNote> {
    const existing = await this.get(id, scope, taskId)
    if (!existing) {
      throw new Error(`Knowledge note not found: ${id}`)
    }

    const updated: KnowledgeNote = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    const path = this.getNotePath(id, scope, taskId)
    await writeFile(path, JSON.stringify(updated, null, 2), 'utf8')

    return updated
  }

  async delete(id: string, scope: KnowledgeNoteScope, taskId?: string): Promise<void> {
    const path = this.getNotePath(id, scope, taskId)

    if (existsSync(path)) {
      await unlink(path)
    }
  }
}
