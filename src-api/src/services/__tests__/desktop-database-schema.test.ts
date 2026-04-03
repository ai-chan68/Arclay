import { afterEach, describe, expect, it, vi } from 'vitest'

type MockDatabase = {
  execute: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
}

function mockDesktopDatabase(db: MockDatabase) {
  ;(globalThis as {
    window?: {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
      }
    }
  }).window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'plugin:sql|load') {
          return args?.db ?? 'sqlite:easywork.db'
        }
        if (cmd === 'plugin:sql|execute') {
          const result = await db.execute(args?.query, args?.values)
          return [result.rowsAffected, result.lastInsertId]
        }
        if (cmd === 'plugin:sql|select') {
          return await db.select(args?.query, args?.values)
        }
        if (cmd === 'plugin:sql|close') {
          return true
        }
        throw new Error(`unexpected tauri invoke: ${cmd}`)
      },
    },
  }
}

describe('desktop database schema invariants', () => {
  afterEach(() => {
    vi.resetModules()
    delete (globalThis as { window?: unknown }).window
  })

  it('fails createSession when migrated sessions table is missing', async () => {
    const db: MockDatabase = {
      execute: vi.fn(async () => {
        throw new Error('no such table: sessions')
      }),
      select: vi.fn(),
    }
    mockDesktopDatabase(db)

    const { createSession } = await import('../../../../src/shared/db/database')

    await expect(
      createSession({
        id: 'session_missing_schema',
        prompt: 'hello',
      })
    ).rejects.toThrow('no such table: sessions')

    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('fails createTask when the migrated tasks columns are missing', async () => {
    const db: MockDatabase = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO tasks')) {
          throw new Error('table tasks has no column named session_id')
        }
        return { rowsAffected: 1, lastInsertId: 1 }
      }),
      select: vi.fn(async () => [{
        id: 'task_legacy',
        session_id: 'session_legacy',
        task_index: 1,
        prompt: 'hello',
        status: 'running',
        cost: null,
        duration: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]),
    }
    mockDesktopDatabase(db)

    const { createTask } = await import('../../../../src/shared/db/database')

    await expect(
      createTask({
        id: 'task_legacy',
        session_id: 'session_legacy',
        task_index: 1,
        prompt: 'hello',
      })
    ).rejects.toThrow('table tasks has no column named session_id')

    expect(db.execute).not.toHaveBeenCalledWith(
      'INSERT INTO tasks (id, prompt) VALUES ($1, $2)',
      ['task_legacy', 'hello']
    )
  })

  it('fails createMessage when the migrated attachments column is missing', async () => {
    const db: MockDatabase = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO messages')) {
          throw new Error('table messages has no column named attachments')
        }
        if (sql.includes('ALTER TABLE messages ADD COLUMN attachments')) {
          return { rowsAffected: 0, lastInsertId: 0 }
        }
        return { rowsAffected: 1, lastInsertId: 1 }
      }),
      select: vi.fn(async () => [{
        id: 1,
        task_id: 'task_1',
        type: 'text',
        content: 'hello',
        tool_name: null,
        tool_input: null,
        tool_output: null,
        tool_use_id: null,
        subtype: 'assistant',
        error_message: null,
        attachments: '[]',
        created_at: new Date().toISOString(),
      }]),
    }
    mockDesktopDatabase(db)

    const { createMessage } = await import('../../../../src/shared/db/database')

    await expect(
      createMessage({
        task_id: 'task_1',
        type: 'text',
        content: 'hello',
        attachments: '[]',
      })
    ).rejects.toThrow('table messages has no column named attachments')

    expect(db.execute).not.toHaveBeenCalledWith(
      'ALTER TABLE messages ADD COLUMN attachments TEXT',
      undefined
    )
  })

  it('fails getTasksBySessionId when the migrated session_id column is missing', async () => {
    const db: MockDatabase = {
      execute: vi.fn(),
      select: vi.fn(async () => {
        throw new Error('no such column: session_id')
      }),
    }
    mockDesktopDatabase(db)

    const { getTasksBySessionId } = await import('../../../../src/shared/db/database')

    await expect(getTasksBySessionId('session_missing_column')).rejects.toThrow(
      'no such column: session_id'
    )
  })
})
