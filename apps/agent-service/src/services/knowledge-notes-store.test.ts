/**
 * Knowledge Notes Store - Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KnowledgeNotesStore } from './knowledge-notes-store'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CreateKnowledgeNoteInput } from '@shared-types'

describe('KnowledgeNotesStore', () => {
  let tempDir: string
  let globalDir: string
  let projectDir: string
  let store: KnowledgeNotesStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'knowledge-notes-test-'))
    globalDir = join(tempDir, 'global')
    projectDir = join(tempDir, 'project')
    store = new KnowledgeNotesStore(globalDir, projectDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('should create a global knowledge note', async () => {
      const input: CreateKnowledgeNoteInput = {
        type: 'context',
        title: 'Test Context',
        content: 'This is test context',
        scope: 'global',
      }

      const note = await store.create(input)

      expect(note.id).toBeDefined()
      expect(note.type).toBe('context')
      expect(note.title).toBe('Test Context')
      expect(note.content).toBe('This is test context')
      expect(note.scope).toBe('global')
      expect(note.enabled).toBe(true)
      expect(note.createdAt).toBeDefined()
      expect(note.updatedAt).toBeDefined()
    })

    it('should create a project knowledge note', async () => {
      const input: CreateKnowledgeNoteInput = {
        type: 'instruction',
        title: 'Test Instruction',
        content: 'Always use TypeScript',
        scope: 'project',
        enabled: false,
      }

      const note = await store.create(input)

      expect(note.scope).toBe('project')
      expect(note.enabled).toBe(false)
    })

    it('should create a task-scoped knowledge note', async () => {
      const input: CreateKnowledgeNoteInput = {
        type: 'reference',
        title: 'API Reference',
        content: 'API docs here',
        scope: 'task',
        taskId: 'task-123',
      }

      const note = await store.create(input)

      expect(note.scope).toBe('task')
      expect(note.taskId).toBe('task-123')
    })
  })

  describe('list', () => {
    it('should list all notes in a scope', async () => {
      const note1 = await store.create({
        type: 'context',
        title: 'Note 1',
        content: 'Content 1',
        scope: 'global',
      })

      // Wait 10ms to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10))

      const note2 = await store.create({
        type: 'instruction',
        title: 'Note 2',
        content: 'Content 2',
        scope: 'global',
      })

      const notes = await store.list('global')

      expect(notes).toHaveLength(2)
      // Sorted by updatedAt desc, so note2 should be first
      expect(notes[0].id).toBe(note2.id)
      expect(notes[1].id).toBe(note1.id)
    })

    it('should return empty array for non-existent scope', async () => {
      const notes = await store.list('project')
      expect(notes).toEqual([])
    })
  })

  describe('listEnabled', () => {
    it('should only return enabled notes', async () => {
      await store.create({
        type: 'context',
        title: 'Enabled',
        content: 'Content',
        scope: 'global',
        enabled: true,
      })

      await store.create({
        type: 'context',
        title: 'Disabled',
        content: 'Content',
        scope: 'global',
        enabled: false,
      })

      const notes = await store.listEnabled('global')

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Enabled')
    })
  })

  describe('get', () => {
    it('should retrieve a note by id', async () => {
      const created = await store.create({
        type: 'context',
        title: 'Test',
        content: 'Content',
        scope: 'global',
      })

      const retrieved = await store.get(created.id, 'global')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.title).toBe('Test')
    })

    it('should return null for non-existent note', async () => {
      const note = await store.get('non-existent', 'global')
      expect(note).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a note', async () => {
      const created = await store.create({
        type: 'context',
        title: 'Original',
        content: 'Original content',
        scope: 'global',
      })

      const updated = await store.update(created.id, 'global', {
        title: 'Updated',
        content: 'Updated content',
      })

      expect(updated.title).toBe('Updated')
      expect(updated.content).toBe('Updated content')
      expect(updated.updatedAt).not.toBe(created.updatedAt)
    })

    it('should throw error for non-existent note', async () => {
      await expect(
        store.update('non-existent', 'global', { title: 'New' })
      ).rejects.toThrow('Knowledge note not found')
    })
  })

  describe('delete', () => {
    it('should delete a note', async () => {
      const created = await store.create({
        type: 'context',
        title: 'To Delete',
        content: 'Content',
        scope: 'global',
      })

      await store.delete(created.id, 'global')

      const retrieved = await store.get(created.id, 'global')
      expect(retrieved).toBeNull()
    })

    it('should not throw error for non-existent note', async () => {
      await expect(
        store.delete('non-existent', 'global')
      ).resolves.not.toThrow()
    })
  })
})
