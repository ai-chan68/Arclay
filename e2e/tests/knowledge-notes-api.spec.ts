/**
 * Knowledge Notes API E2E Test
 *
 * Verifies Knowledge Notes REST API endpoints
 */

import { expect, test } from '@playwright/test'

const API_BASE = process.env.ARCLAY_E2E_API_PORT
  ? `http://localhost:${process.env.ARCLAY_E2E_API_PORT}`
  : 'http://localhost:2026'

test.describe('Knowledge Notes API', () => {
  test('should create and retrieve a global knowledge note', async ({ request }) => {
    // Create a note
    const createResponse = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'context',
        title: 'Test Context',
        content: 'This is a test context for E2E',
        scope: 'global',
        enabled: true,
      },
    })

    expect(createResponse.ok()).toBeTruthy()
    const { note: created } = await createResponse.json()
    expect(created.id).toBeDefined()
    expect(created.title).toBe('Test Context')
    expect(created.scope).toBe('global')

    // Retrieve the note
    const getResponse = await request.get(
      `${API_BASE}/api/knowledge-notes/${created.id}?scope=global`
    )

    expect(getResponse.ok()).toBeTruthy()
    const { note: retrieved } = await getResponse.json()
    expect(retrieved.id).toBe(created.id)
    expect(retrieved.content).toBe('This is a test context for E2E')

    // Cleanup
    await request.delete(`${API_BASE}/api/knowledge-notes/${created.id}?scope=global`)
  })

  test('should list knowledge notes by scope', async ({ request }) => {
    // Create two notes
    const note1Response = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'instruction',
        title: 'Instruction 1',
        content: 'Always use TypeScript',
        scope: 'global',
      },
    })
    const { note: note1 } = await note1Response.json()

    const note2Response = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'reference',
        title: 'Reference 1',
        content: 'API documentation',
        scope: 'global',
      },
    })
    const { note: note2 } = await note2Response.json()

    // List notes
    const listResponse = await request.get(`${API_BASE}/api/knowledge-notes?scope=global`)
    expect(listResponse.ok()).toBeTruthy()

    const { notes } = await listResponse.json()
    expect(notes.length).toBeGreaterThanOrEqual(2)

    const createdIds = [note1.id, note2.id]
    const foundNotes = notes.filter((n: { id: string }) => createdIds.includes(n.id))
    expect(foundNotes.length).toBe(2)

    // Cleanup
    await request.delete(`${API_BASE}/api/knowledge-notes/${note1.id}?scope=global`)
    await request.delete(`${API_BASE}/api/knowledge-notes/${note2.id}?scope=global`)
  })

  test('should update a knowledge note', async ({ request }) => {
    // Create
    const createResponse = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'context',
        title: 'Original Title',
        content: 'Original content',
        scope: 'global',
      },
    })
    const { note: created } = await createResponse.json()

    // Update
    const updateResponse = await request.put(
      `${API_BASE}/api/knowledge-notes/${created.id}?scope=global`,
      {
        data: {
          title: 'Updated Title',
          content: 'Updated content',
        },
      }
    )

    expect(updateResponse.ok()).toBeTruthy()
    const { note: updated } = await updateResponse.json()
    expect(updated.title).toBe('Updated Title')
    expect(updated.content).toBe('Updated content')

    // Cleanup
    await request.delete(`${API_BASE}/api/knowledge-notes/${created.id}?scope=global`)
  })

  test('should delete a knowledge note', async ({ request }) => {
    // Create
    const createResponse = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'context',
        title: 'To Delete',
        content: 'Will be deleted',
        scope: 'global',
      },
    })
    const { note: created } = await createResponse.json()

    // Delete
    const deleteResponse = await request.delete(
      `${API_BASE}/api/knowledge-notes/${created.id}?scope=global`
    )
    expect(deleteResponse.ok()).toBeTruthy()

    // Verify deletion
    const getResponse = await request.get(
      `${API_BASE}/api/knowledge-notes/${created.id}?scope=global`
    )
    expect(getResponse.status()).toBe(404)
  })

  test('should filter enabled notes', async ({ request }) => {
    // Create enabled and disabled notes
    const enabledResponse = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'context',
        title: 'Enabled Note',
        content: 'Content',
        scope: 'global',
        enabled: true,
      },
    })
    const { note: enabledNote } = await enabledResponse.json()

    const disabledResponse = await request.post(`${API_BASE}/api/knowledge-notes`, {
      data: {
        type: 'context',
        title: 'Disabled Note',
        content: 'Content',
        scope: 'global',
        enabled: false,
      },
    })
    const { note: disabledNote } = await disabledResponse.json()

    // List all notes
    const listResponse = await request.get(`${API_BASE}/api/knowledge-notes?scope=global`)
    const { notes } = await listResponse.json()

    const enabledNotes = notes.filter((n: { enabled: boolean }) => n.enabled)
    const disabledNotes = notes.filter((n: { enabled: boolean }) => !n.enabled)

    expect(enabledNotes.some((n: { id: string }) => n.id === enabledNote.id)).toBeTruthy()
    expect(disabledNotes.some((n: { id: string }) => n.id === disabledNote.id)).toBeTruthy()

    // Cleanup
    await request.delete(`${API_BASE}/api/knowledge-notes/${enabledNote.id}?scope=global`)
    await request.delete(`${API_BASE}/api/knowledge-notes/${disabledNote.id}?scope=global`)
  })
})
