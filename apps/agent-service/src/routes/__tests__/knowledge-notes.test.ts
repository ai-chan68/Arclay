import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import knowledgeNotesApp from '../knowledge-notes'
import type { CreateKnowledgeNoteInput, UpdateKnowledgeNoteInput } from '@shared-types'

describe('knowledge-notes routes', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.route('/api/knowledge-notes', knowledgeNotesApp)
  })

  describe('GET /api/knowledge-notes', () => {
    it('should return 400 if scope is missing', async () => {
      const res = await app.request('/api/knowledge-notes')
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid scope')
    })

    it('should return 400 if scope is not global', async () => {
      const res = await app.request('/api/knowledge-notes?scope=project')
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid scope')
    })

    it('should list knowledge notes with global scope', async () => {
      const res = await app.request('/api/knowledge-notes?scope=global')
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toHaveProperty('notes')
      expect(Array.isArray(json.notes)).toBe(true)
    })
  })

  describe('GET /api/knowledge-notes/:id', () => {
    it('should return 400 if scope is missing', async () => {
      const res = await app.request('/api/knowledge-notes/test-id')
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid scope')
    })

    it('should return 404 if note not found', async () => {
      const res = await app.request('/api/knowledge-notes/nonexistent?scope=global')
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toContain('not found')
    })
  })

  describe('POST /api/knowledge-notes', () => {
    it('should return 400 if required fields are missing', async () => {
      const res = await app.request('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Missing required fields')
    })

    it('should return 400 if type is invalid', async () => {
      const input = {
        type: 'invalid',
        title: 'Test',
        content: 'Content',
        scope: 'global',
      }
      const res = await app.request('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid type')
    })

    it('should return 400 if scope is not global', async () => {
      const input = {
        type: 'context',
        title: 'Test',
        content: 'Content',
        scope: 'project',
      }
      const res = await app.request('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid scope')
    })

    it('should create knowledge note with valid input', async () => {
      const input: CreateKnowledgeNoteInput = {
        type: 'context',
        title: 'Test Note',
        content: 'Test content',
        scope: 'global',
        enabled: true,
      }
      const res = await app.request('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json).toHaveProperty('note')
      expect(json.note.title).toBe('Test Note')
      expect(json.note.type).toBe('context')
    })
  })

  describe('PUT /api/knowledge-notes/:id', () => {
    it('should return 400 if scope is missing', async () => {
      const res = await app.request('/api/knowledge-notes/test-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid scope')
    })

    it('should update knowledge note', async () => {
      // First create a note
      const createInput: CreateKnowledgeNoteInput = {
        type: 'instruction',
        title: 'Original Title',
        content: 'Original content',
        scope: 'global',
        enabled: true,
      }
      const createRes = await app.request('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createInput),
      })
      const createJson = await createRes.json()
      const noteId = createJson.note.id

      // Then update it
      const updateInput: UpdateKnowledgeNoteInput = {
        title: 'Updated Title',
        content: 'Updated content',
      }
      const updateRes = await app.request(`/api/knowledge-notes/${noteId}?scope=global`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateInput),
      })
      expect(updateRes.status).toBe(200)
      const updateJson = await updateRes.json()
      expect(updateJson.note.title).toBe('Updated Title')
      expect(updateJson.note.content).toBe('Updated content')
    })
  })

  describe('DELETE /api/knowledge-notes/:id', () => {
    it('should return 400 if scope is missing', async () => {
      const res = await app.request('/api/knowledge-notes/test-id', {
        method: 'DELETE',
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid scope')
    })

    it('should delete knowledge note', async () => {
      // First create a note
      const createInput: CreateKnowledgeNoteInput = {
        type: 'reference',
        title: 'To Delete',
        content: 'Will be deleted',
        scope: 'global',
        enabled: true,
      }
      const createRes = await app.request('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createInput),
      })
      const createJson = await createRes.json()
      const noteId = createJson.note.id

      // Then delete it
      const deleteRes = await app.request(`/api/knowledge-notes/${noteId}?scope=global`, {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(200)
      const deleteJson = await deleteRes.json()
      expect(deleteJson.success).toBe(true)

      // Verify it's deleted
      const getRes = await app.request(`/api/knowledge-notes/${noteId}?scope=global`)
      expect(getRes.status).toBe(404)
    })
  })
})
