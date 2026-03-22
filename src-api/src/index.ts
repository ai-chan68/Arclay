import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { routes } from './routes'
import { setAgentService as setNewAgentService } from './routes/agent-new'
import { setSandboxService } from './routes/sandbox'
import { setPreviewSandboxService } from './routes/preview'
import { AgentService, createAgentService, type AgentServiceConfig } from './services/agent-service'
import { getProviderConfig, getWorkDir, getFrontendUrl, logConfig, validateConfig } from './config'
import { createSandboxService } from './core/sandbox/sandbox-service'
import { createServer as createHttpServer } from 'node:http'
import { getSettings, getActiveProviderConfig, normalizeSandboxSettings } from './settings-store'
import type { SkillsConfig, SandboxConfig, McpConfig } from './core/agent/types'
import { initializeProviders } from './core/agent/providers'
import { providerManager } from './shared/provider/manager'
import { scheduledTaskScheduler } from './services/scheduled-task-scheduler'
import { approvalCoordinator } from './services/approval-coordinator'
import { planStore } from './services/plan-store'
import { cancelTurnsForExpiredPlans } from './services/plan-turn-sync'
import { bootstrapRuntimeRecovery } from './services/runtime-recovery-bootstrap'
import { turnRuntimeStore } from './services/turn-runtime-store'

// Detect if running as Tauri sidecar
const isTauriSidecar = process.env.TAURI_FAMILY === 'sidecar'

// Initialize agent providers
initializeProviders()
void providerManager.initialize()

const app = new Hono()

bootstrapRuntimeRecovery({
  approvalCoordinator,
  planStore,
  turnRuntimeStore,
  cancelExpiredPlanTurns: (records) => cancelTurnsForExpiredPlans(records, {
    cancelPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsCanceled(scope, reason),
  }),
  logInfo: console.log,
})

// Initialize sandbox service (doesn't require API key)
const workDir = getWorkDir()
const sandboxService = await createSandboxService(workDir)
setSandboxService(sandboxService)
setPreviewSandboxService(sandboxService)

// Get skills config from settings
function getSkillsConfig(): SkillsConfig {
  const settings = getSettings()
  // Skills are enabled by default if not explicitly disabled
  const enabled = settings?.skills?.enabled !== false
  return {
    enabled,
    userDirEnabled: false,  // 不使用用户目录的 skills
    appDirEnabled: true,    // 使用项目目录的 skills
  }
}

function getMcpConfig(): McpConfig | undefined {
  const settings = getSettings()
  if (!settings?.mcp?.enabled) {
    return undefined
  }

  // 转换 settings-store 的 McpServerConfig 到 agent types 的 McpServerConfig
  const mcpServers: Record<string, import('./core/agent/types').McpServerConfig> = {}
  if (settings.mcp.mcpServers) {
    for (const [name, config] of Object.entries(settings.mcp.mcpServers)) {
      // 支持 stdio、sse、http 三种传输类型
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
  }

  return {
    enabled: true,
    userDirEnabled: false,
    appDirEnabled: false,
    mcpServers,
  }
}

function getSandboxConfig(): SandboxConfig | undefined {
  const settings = getSettings()
  const sandbox = normalizeSandboxSettings(settings?.sandbox)
  if (!sandbox.enabled) {
    return undefined
  }

  return {
    enabled: true,
    provider: sandbox.provider,
    image: sandbox.image,
    apiEndpoint: sandbox.apiEndpoint,
  }
}

// Try to initialize agent service
// Priority: 1. Saved settings from file (active provider), 2. Environment variables
let agentService: AgentService | null = null
let agentServiceConfig: AgentServiceConfig | null = null

try {
  // First check for active provider in saved settings
  const activeProvider = getActiveProviderConfig()
  const skillsConfig = getSkillsConfig()
  const mcpConfig = getMcpConfig()
  const sandboxConfig = getSandboxConfig()

  if (activeProvider && activeProvider.apiKey) {
    console.log('[API] Using active provider from saved settings')
    agentServiceConfig = {
      provider: {
        provider: activeProvider.provider as 'claude' | 'glm' | 'openai' | 'openrouter' | 'kimi' | 'deepseek',
        apiKey: activeProvider.apiKey,
        model: activeProvider.model,
        baseUrl: activeProvider.baseUrl,
      },
      workDir,
      skills: skillsConfig,
      mcp: mcpConfig,
      sandbox: sandboxConfig,
    }
    agentService = createAgentService(
      agentServiceConfig.provider,
      workDir,
      skillsConfig,
      mcpConfig,
      sandboxConfig
    )
    setNewAgentService(agentService, agentServiceConfig)
    console.log(`[API] Agent service initialized with provider: ${activeProvider.provider}, model: ${activeProvider.model}, skills: ${skillsConfig.enabled ? 'enabled' : 'disabled'}, mcp: ${mcpConfig ? 'enabled' : 'disabled'}\n`)
  } else {
    // Fall back to environment config
    const providerConfig = getProviderConfig()

    // Only create agent service if API key is configured
    if (providerConfig.apiKey && providerConfig.apiKey !== '') {
      agentServiceConfig = {
        provider: providerConfig,
        workDir,
        skills: skillsConfig,
        mcp: mcpConfig,
        sandbox: sandboxConfig,
      }
      agentService = createAgentService(providerConfig, workDir, skillsConfig, mcpConfig, sandboxConfig)
      setNewAgentService(agentService, agentServiceConfig)
      logConfig()
      console.log(`[API] Skills: ${skillsConfig.enabled ? 'enabled' : 'disabled'}, mcp: ${mcpConfig ? 'enabled' : 'disabled'}\n`)
    } else {
      console.log('[API] No API key configured. Agent service will be available after settings are saved.')
      console.log('[API] Please configure your API key in the Settings page.\n')
    }
  }
} catch (error) {
  console.error('Failed to initialize agent service:', error)
  console.log('[API] Agent service will be available after settings are saved.\n')
}

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: [getFrontendUrl(), 'http://localhost:1420', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))

// Routes
app.route('/api', routes)

// 404 handler
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

// Find available port
async function findAvailablePort(startPort: number): Promise<number> {
  const nodeNet = await import('net')

  return new Promise((resolve, reject) => {
    const server = nodeNet.createServer()
    server.listen(startPort, () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : startPort
      server.close(() => resolve(port))
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1))
      } else {
        reject(err)
      }
    })
  })
}

// Start server with port auto-selection
async function startServer() {
  const defaultPort = parseInt(process.env.PORT || '2026', 10)
  const port = await findAvailablePort(defaultPort)

  console.log(`\nAPI server running on http://localhost:${port}`)
  if (isTauriSidecar) {
    console.log('Running as Tauri sidecar')
  }
  console.log('Press Ctrl+C to stop\n')

  // Use native http server with Hono's fetch handler for better pkg compatibility
  const server = createHttpServer((req, res) => {
    // Convert Node.js request to Web Request
    const url = `http://localhost:${port}${req.url}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
    }

    let body: ReadableStream<Uint8Array> | null = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = new ReadableStream({
        start(controller) {
          req.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk))
          })
          req.on('end', () => {
            controller.close()
          })
          req.on('error', (err) => {
            controller.error(err)
          })
        }
      })
    }

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body,
      duplex: 'half'
    })

    void (async () => {
      try {
        const response = await app.fetch(webRequest)
        res.statusCode = response.status
        response.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value)
        })
        if (response.body) {
          const reader = response.body.getReader()
          const pump = (): Promise<void> =>
            reader.read().then((result) => {
              if (result.done) {
                res.end()
                return Promise.resolve()
              }
              res.write(Buffer.from(result.value))
              return pump()
            })
          await pump()
        } else {
          res.end()
        }
      } catch (err: unknown) {
        console.error('Server error:', err)
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })()
  })

  server.listen(port)
  scheduledTaskScheduler.start()

  // Graceful shutdown for sidecar
  const shutdown = () => {
    console.log('\nShutting down gracefully...')
    scheduledTaskScheduler.stop()
    approvalCoordinator.stopLifecycleSweep()
    planStore.stopLifecycleSweep()
    server.close(() => {
      console.log('Server closed')
      process.exit(0)
    })

    // Force exit after 10 seconds
    setTimeout(() => {
      console.log('Forcing exit...')
      process.exit(1)
    }, 10000)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return port
}

if (typeof process !== 'undefined' && !process.env.VITEST) {
  startServer().catch(console.error)
}

export { app }
