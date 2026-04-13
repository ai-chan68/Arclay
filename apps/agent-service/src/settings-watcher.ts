/**
 * Watch settings.json for external changes (e.g. manual edits).
 *
 * When a change is detected, the MCP section is hash-compared against the
 * last-known value.  If the hash differs, the in-memory settings cache is
 * refreshed and the AgentService is recreated so MCP servers are
 * reconnected without an app restart.
 */

import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createLogger } from './shared/logger'
import { resolveArclayPath } from './shared/arclay-home'
import {
  loadSettingsFromFile,
  setSettings,
  getSettings,
  getActiveProviderConfig,
  type Settings,
} from './settings-store'
import { createAgentService, type AgentServiceConfig } from './services/agent-service'
import type { AgentRuntimeState } from './runtime/app-runtime'

const log = createLogger('settings-watcher')

/** Debounce interval in ms — files are often written in multiple flushes. */
const DEBOUNCE_MS = 500

interface SettingsWatcherDeps {
  getAgentRuntimeState: () => AgentRuntimeState
  setAgentRuntimeState: (state: AgentRuntimeState) => void
  workDir: string
}

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastMcpHash = ''

function hashMcpSection(settings: Settings | null): string {
  const mcp = settings?.mcp
  if (!mcp) return ''
  return createHash('sha256').update(JSON.stringify(mcp)).digest('hex')
}

function buildMcpConfig(settings: Settings): AgentServiceConfig['mcp'] {
  if (!settings.mcp?.enabled) return undefined

  const mcpServers: Record<string, { type: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }> = {}
  for (const [name, config] of Object.entries(settings.mcp.mcpServers || {})) {
    if (config.type === 'stdio' || config.type === 'sse' || config.type === 'http') {
      mcpServers[name] = {
        type: config.type,
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
      }
    }
  }

  return { enabled: true, userDirEnabled: false, appDirEnabled: false, mcpServers }
}

function handleFileChange(deps: SettingsWatcherDeps): void {
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void reloadIfChanged(deps)
  }, DEBOUNCE_MS)
}

async function reloadIfChanged(deps: SettingsWatcherDeps): Promise<void> {
  try {
    const settingsPath = resolveArclayPath('settings.json')
    const raw = await readFile(settingsPath, 'utf-8')

    // Quick sanity check — avoid parsing broken files mid-write
    let parsed: Settings
    try {
      parsed = JSON.parse(raw) as Settings
    } catch {
      log.debug('Skipping reload — settings.json is not valid JSON (likely mid-write)')
      return
    }

    const newHash = hashMcpSection(parsed)
    if (newHash === lastMcpHash) return

    log.info('MCP config changed externally, reloading')
    lastMcpHash = newHash

    // Reload full settings into cache
    const loaded = loadSettingsFromFile()
    if (loaded) setSettings(loaded)

    // Recreate AgentService if a provider is active
    const activeProvider = getActiveProviderConfig()
    if (!activeProvider?.apiKey) return

    const settings = getSettings()
    if (!settings) return

    const skillsConfig = {
      enabled: settings.skills?.enabled !== false,
      userDirEnabled: false,
      appDirEnabled: true,
    }
    const mcpConfig = buildMcpConfig(settings)

    const agentService = createAgentService(
      {
        provider: activeProvider.provider as 'claude' | 'glm' | 'openai' | 'openrouter' | 'kimi' | 'deepseek',
        apiKey: activeProvider.apiKey,
        model: activeProvider.model,
        baseUrl: activeProvider.baseUrl,
      },
      deps.workDir,
      skillsConfig,
      mcpConfig,
    )

    deps.setAgentRuntimeState({
      agentService,
      agentServiceConfig: {
        provider: {
          provider: activeProvider.provider as 'claude' | 'glm' | 'openai' | 'openrouter' | 'kimi' | 'deepseek',
          apiKey: activeProvider.apiKey,
          model: activeProvider.model,
          baseUrl: activeProvider.baseUrl,
        },
        workDir: deps.workDir,
        skills: skillsConfig,
        mcp: mcpConfig,
      },
    })

    log.info('AgentService recreated after external settings change')
  } catch (err) {
    log.error(err, 'Failed to reload settings')
  }
}

export function startSettingsWatcher(deps: SettingsWatcherDeps): void {
  if (watcher) return

  // Capture initial hash so the first real change triggers reload
  lastMcpHash = hashMcpSection(getSettings())

  const settingsPath = resolveArclayPath('settings.json')

  try {
    watcher = watch(settingsPath, { persistent: false }, () => {
      handleFileChange(deps)
    })

    watcher.on('error', (err) => {
      log.warn(err, 'Settings watcher error, stopping')
      stopSettingsWatcher()
    })

    log.info({ path: settingsPath }, 'Settings watcher started')
  } catch (err) {
    log.warn(err, 'Failed to start settings watcher — external changes will not be auto-detected')
  }
}

export function stopSettingsWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
    log.info('Settings watcher stopped')
  }
}
