export interface McpServerConfigLike {
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
}

export interface McpRenameResult<T extends McpServerConfigLike> {
  changed: boolean
  nextName: string
  servers: Record<string, T>
  error?: 'empty' | 'duplicate'
}

export function syncMcpNameDrafts(
  serverNames: string[],
  previousDrafts: Record<string, string>
): Record<string, string> {
  const nextDrafts: Record<string, string> = {}

  for (const name of serverNames) {
    nextDrafts[name] = previousDrafts[name] ?? name
  }

  return nextDrafts
}

export function renameMcpServerRecord<T extends McpServerConfigLike>(
  servers: Record<string, T>,
  oldName: string,
  proposedName: string
): McpRenameResult<T> {
  const nextName = proposedName.trim()

  if (!nextName) {
    return { changed: false, nextName: oldName, servers, error: 'empty' }
  }

  if (nextName === oldName) {
    return { changed: false, nextName: oldName, servers }
  }

  if (Object.prototype.hasOwnProperty.call(servers, nextName)) {
    return { changed: false, nextName: oldName, servers, error: 'duplicate' }
  }

  const nextServers: Record<string, T> = {}
  for (const [name, config] of Object.entries(servers)) {
    nextServers[name === oldName ? nextName : name] = config
  }

  return { changed: true, nextName, servers: nextServers }
}
