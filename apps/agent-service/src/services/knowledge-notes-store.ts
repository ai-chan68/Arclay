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

  constructor(globalDir: string) {
    this.globalDir = globalDir
  }

  private getScopeDir(scope: KnowledgeNoteScope): string {
    return this.globalDir
  }

  private getNotePath(id: string, scope: KnowledgeNoteScope): string {
    const dir = this.getScopeDir(scope)
    return join(dir, `${id}.json`)
  }

  async list(scope: KnowledgeNoteScope): Promise<KnowledgeNote[]> {
    const dir = this.getScopeDir(scope)

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

  async listEnabled(scope: KnowledgeNoteScope): Promise<KnowledgeNote[]> {
    const all = await this.list(scope)
    return all.filter(note => note.enabled)
  }

  async get(id: string, scope: KnowledgeNoteScope): Promise<KnowledgeNote | null> {
    const path = this.getNotePath(id, scope)

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
    }

    const dir = this.getScopeDir(input.scope)
    await mkdir(dir, { recursive: true })

    const path = this.getNotePath(id, input.scope)
    await writeFile(path, JSON.stringify(note, null, 2), 'utf8')

    return note
  }

  async update(id: string, scope: KnowledgeNoteScope, updates: UpdateKnowledgeNoteInput): Promise<KnowledgeNote> {
    const existing = await this.get(id, scope)
    if (!existing) {
      throw new Error(`Knowledge note not found: ${id}`)
    }

    const updated: KnowledgeNote = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    const path = this.getNotePath(id, scope)
    await writeFile(path, JSON.stringify(updated, null, 2), 'utf8')

    return updated
  }

  async delete(id: string, scope: KnowledgeNoteScope): Promise<void> {
    const path = this.getNotePath(id, scope)

    if (existsSync(path)) {
      await unlink(path)
    }
  }
}
