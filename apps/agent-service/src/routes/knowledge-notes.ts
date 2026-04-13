/**
 * Knowledge Notes API Routes
 */

import { Hono } from 'hono'
import { join } from 'path'
import type { CreateKnowledgeNoteInput, UpdateKnowledgeNoteInput, KnowledgeNoteScope } from '@shared-types'
import { KnowledgeNotesStore } from '../services/knowledge-notes-store'
import { resolveArclayHome } from '../shared/arclay-home'
import { createLogger } from '../shared/logger'

const log = createLogger('routes:knowledge-notes')

const app = new Hono()

function getKnowledgeNotesStore(): KnowledgeNotesStore {
  const globalDir = join(resolveArclayHome(), 'knowledge-notes')
  return new KnowledgeNotesStore(globalDir)
}

// List knowledge notes
app.get('/', async (c) => {
  try {
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined

    if (!scope || scope !== 'global') {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore()
    const notes = await store.list(scope)

    return c.json({ notes })
  } catch (error) {
    log.error({ err: error }, 'List failed')
    return c.json({ error: 'Failed to list knowledge notes' }, 500)
  }
})

// Get single knowledge note
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined

    if (!scope || scope !== 'global') {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore()
    const note = await store.get(id, scope)

    if (!note) {
      return c.json({ error: 'Knowledge note not found' }, 404)
    }

    return c.json({ note })
  } catch (error) {
    log.error({ err: error }, 'Get failed')
    return c.json({ error: 'Failed to get knowledge note' }, 500)
  }
})

// Create knowledge note
app.post('/', async (c) => {
  try {
    const body = await c.req.json() as CreateKnowledgeNoteInput

    if (!body.type || !body.title || !body.content || !body.scope) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    if (!['context', 'instruction', 'reference'].includes(body.type)) {
      return c.json({ error: 'Invalid type' }, 400)
    }

    if (body.scope !== 'global') {
      return c.json({ error: 'Invalid scope' }, 400)
    }

    const store = getKnowledgeNotesStore()
    const note = await store.create(body)

    return c.json({ note }, 201)
  } catch (error) {
    log.error({ err: error }, 'Create failed')
    return c.json({ error: 'Failed to create knowledge note' }, 500)
  }
})

// Update knowledge note
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined
    const body = await c.req.json() as UpdateKnowledgeNoteInput

    if (!scope || scope !== 'global') {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore()
    const note = await store.update(id, scope, body)

    return c.json({ note })
  } catch (error) {
    log.error({ err: error }, 'Update failed')
    const message = error instanceof Error ? error.message : 'Failed to update knowledge note'
    return c.json({ error: message }, 500)
  }
})

// Delete knowledge note
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = c.req.query('scope') as KnowledgeNoteScope | undefined

    if (!scope || scope !== 'global') {
      return c.json({ error: 'Invalid scope parameter' }, 400)
    }

    const store = getKnowledgeNotesStore()
    await store.delete(id, scope)

    return c.json({ success: true })
  } catch (error) {
    log.error({ err: error }, 'Delete failed')
    return c.json({ error: 'Failed to delete knowledge note' }, 500)
  }
})

export default app
