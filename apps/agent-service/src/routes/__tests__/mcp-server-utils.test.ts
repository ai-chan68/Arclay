import { describe, expect, it } from 'vitest'
import { renameMcpServerRecord, syncMcpNameDrafts } from '../../../../src/shared/lib/mcp-server-utils'

describe('renameMcpServerRecord', () => {
  it('renames a server only when the final name is committed', () => {
    const result = renameMcpServerRecord(
      {
        server_1: { type: 'stdio', command: 'npx', args: [] },
      },
      'server_1',
      'aaa'
    )

    expect(result.changed).toBe(true)
    expect(result.nextName).toBe('aaa')
    expect(result.servers).toEqual({
      aaa: { type: 'stdio', command: 'npx', args: [] },
    })
  })

  it('rejects duplicate target names', () => {
    const servers = {
      chrome: { type: 'stdio' as const },
      filesystem: { type: 'stdio' as const },
    }

    const result = renameMcpServerRecord(servers, 'filesystem', 'chrome')

    expect(result.changed).toBe(false)
    expect(result.error).toBe('duplicate')
    expect(result.servers).toBe(servers)
  })
})

describe('syncMcpNameDrafts', () => {
  it('preserves in-progress draft values for existing servers', () => {
    expect(
      syncMcpNameDrafts(['server_1', 'server_2'], {
        server_1: 'aa',
      })
    ).toEqual({
      server_1: 'aa',
      server_2: 'server_2',
    })
  })
})
