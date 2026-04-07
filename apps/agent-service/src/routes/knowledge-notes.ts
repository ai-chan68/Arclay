/**
 * Knowledge Notes API Routes
 */

import { Hono } from 'hono'
import { join } from 'path'
import { homedir } from 'os'
import type { CreateKnowledgeNoteInput, UpdateKnowledgeNoteInput, KnowledgeNoteScope } from '@shared-types'
import { KnowledgeNotesStore } from '../services/knowledge-notes-store'

const app = new Hono()

function resolveEasyWorkHome(): string {
  const configuredHome = process.env.EASYWORK_HOME?.trim()
  if (configuredHome) {
    return configuredHome
  }
  return join(homedir(), '.easywork')
}

function getKnowledgeNotesStore(workDir: string): KnowledgeNotesStore {
  const globalDir = join(resolveEasyWorkHome(), 'knowledge-notes')
  const projectDir = join(workDir, '.easywork', 'knowledge-notes')
  return new KnowledgeNotesStore(globalDir, projectDir)
}

// List knowledge notes
app.get('/knowledge-notes', async (c) => {
  try {
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined
    const taskId = c.req.query('taskId')
    const workDir = c.req.query('workDir') || process.cwd()

    if (!scope || !['global', 'project', 'task'].includes(scope)) {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    if (scope === 'task' && !taskId) {
      return c.json({ error: 'taskId required for task scope' }, 400)
    }

    const store = getKnowledgeNotesStore(workDir)
    const notes = await store.list(scope, taskId)

    return c.json({ notes })
  } catch (error) {
    console.error('[KnowledgeNotes] List failed:', error)
    return c.json({ error: 'Failed to list knowledge notes' }, 500)
  }
})

// Get single knowledge note
app.get('/knowledge-notes/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined
    const taskId = c.req.query('taskId')
    const workDir = c.req.query('workDir') || process.cwd()

    if (!scope || !['global', 'project', 'task'].includes(scope)) {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore(workDir)
    const note = await store.get(id, scope, taskId)

    if (!note) {
      return c.json({ error: 'Knowledge note not found' }, 404)
    }

    return c.json({ note })
  } catch (error) {
    console.error('[KnowledgeNotes] Get failed:', error)
    return c.json({ error: 'Failed to get knowledge note' }, 500)
  }
})

// Create knowledge note
app.post('/knowledge-notes', async (c) => {
  try {
    const workDir = c.req.query('workDir') || process.cwd()
    const body = await c.req.json() as CreateKnowledgeNoteInput

    if (!body.type || !body.title || !body.content || !body.scope) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    if (!['context', 'instruction', 'reference'].includes(body.type)) {
      return c.json({ error: 'Invalid type' }, 400)
    }

    if (!['global', 'project', 'task'].includes(body.scope)) {
      return c.json({ error: 'Invalid scope' }, 400)
    }

    if (body.scope === 'task' && !body.taskId) {
      return c.json({ error: 'taskId required for task scope' }, 400)
    }

    const store = getKnowledgeNotesStore(workDir)
    const note = await store.create(body)

    return c.json({ note }, 201)
  } catch (error) {
    console.error('[KnowledgeNotes] Create failed:', error)
    return c.json({ error: 'Failed to create knowledge note' }, 500)
  }
})

// Update knowledge note
app.put('/knowledge-notes/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined
    const taskId = c.req.query('taskId')
    const workDir = c.req.query('workDir') || process.cwd()
    const body = await c.req.json() as UpdateKnowledgeNoteInput

    if (!scope || !['global', 'project', 'task'].includes(scope)) {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore(workDir)
    const note = await store.update(id, scope, body, taskId)

    return c.json({ note })
  } catch (error) {
    console.error('[KnowledgeNotes] Update failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to update knowledge note'
    return c.json({ error: message }, 500)
  }
})

// Delete knowledge note
app.delete('/knowledge-notes/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined
    const taskId = c.req.query('taskId')
    const workDir = c.req.query('workDir') || process.cwd()

    if (!scope || !['global', 'project', 'task'].includes(scope)) {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore(workDir)
    await store.delete(id, scope, taskId)

    return c.json({ success: true })
  } catch (error) {
    console.error('[KnowledgeNotes] Delete failed:', error)
    return c.json({ error: 'Failed to delete knowledge note' }, 500)
  }
})

export default app
