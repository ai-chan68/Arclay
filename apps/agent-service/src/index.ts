import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createRoutes } from './routes'
import { setSandboxService } from './routes/sandbox'
import { setPreviewSandboxService } from './routes/preview'
import { getFrontendUrl, logConfig } from './config'
import { createServer as createHttpServer } from 'node:http'
import { getActiveProviderConfig } from './settings-store'
import { initializeProviders } from './core/agent/providers'
import { providerManager } from './shared/provider/manager'
import { ScheduledTaskScheduler } from './services/scheduled-task-scheduler'
import { approvalCoordinator } from './services/approval-coordinator'
import { planStore } from './services/plan-store'
import { cancelTurnsForExpiredPlans } from './services/plan-turn-sync'
import { bootstrapRuntimeRecovery } from './services/runtime-recovery-bootstrap'
import { turnRuntimeStore } from './services/turn-runtime-store'
import { createAppRuntime } from './runtime/app-runtime'
import { homedir, platform } from 'os'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'

// Detect if running as Tauri sidecar
const isTauriSidecar = process.env.TAURI_FAMILY === 'sidecar'

// Extend PATH early for Tauri sidecar environment
if (isTauriSidecar || !process.env.PATH?.includes('/opt/homebrew/bin')) {
  const home = homedir()
  const os = platform()
  const isWindows = os === 'win32'
  const pathSeparator = isWindows ? ';' : ':'

  const paths = [process.env.PATH || '']

  if (isWindows) {
    paths.push(
      join(home, 'AppData', 'Roaming', 'npm'),
      join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
      join(home, '.volta', 'bin'),
      'C:\\Program Files\\nodejs'
    )
  } else {
    paths.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      join(home, '.local', 'bin'),
      join(home, '.npm-global', 'bin'),
      join(home, '.volta', 'bin')
    )

    // Add nvm paths
    const nvmDir = join(home, '.nvm', 'versions', 'node')
    try {
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir)
        for (const version of versions) {
          paths.push(join(nvmDir, version, 'bin'))
        }
      }
    } catch {
      // nvm not installed
    }
  }

  process.env.PATH = paths.join(pathSeparator)
  console.log('[Startup] Extended PATH for Tauri sidecar environment')
}

// Initialize agent providers
initializeProviders()

// Initialize provider manager and wait for it to complete
providerManager.initialize()
  .then(() => {
    console.log('[Startup] Provider manager initialized')
  })
  .catch((error) => {
    console.error('[Startup] Failed to initialize provider manager:', error)
  })

const runtime = createAppRuntime()
const scheduledTaskScheduler = new ScheduledTaskScheduler({
  getAgentRuntimeState: runtime.getAgentRuntimeState,
  workDir: runtime.workDir,
})

const app = new Hono()
const routes = createRoutes({
  agentNew: {
    getAgentRuntimeState: runtime.getAgentRuntimeState,
    workDir: runtime.workDir,
  },
  settings: {
    getAgentRuntimeState: runtime.getAgentRuntimeState,
    setAgentRuntimeState: runtime.setAgentRuntimeState,
    workDir: runtime.workDir,
  },
  scheduledTasks: {
    getAgentRuntimeState: runtime.getAgentRuntimeState,
    scheduler: scheduledTaskScheduler,
    workDir: runtime.workDir,
  },
})

bootstrapRuntimeRecovery({
  approvalCoordinator,
  planStore,
  turnRuntimeStore,
  cancelExpiredPlanTurns: (records) => cancelTurnsForExpiredPlans(records, {
    cancelPendingApprovals: (scope, reason) => approvalCoordinator.markPendingAsCanceled(scope, reason),
  }),
  logInfo: console.log,
})

function initializeSandboxServices(): Promise<void> {
  return runtime.initializeSandboxServices().then((sandboxService) => {
      setSandboxService(sandboxService)
      setPreviewSandboxService(sandboxService)
  })
}

void initializeSandboxServices().catch((error) => {
  console.error('Failed to initialize sandbox service:', error)
})

logInitialAgentRuntime()

const allowedCorsOrigins = Array.from(new Set([
  getFrontendUrl(),
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
]))

// Middleware
app.use('*', cors({
  origin: allowedCorsOrigins,
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
  await initializeSandboxServices()

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

function logInitialAgentRuntime(): void {
  const { agentService, agentServiceConfig } = runtime.getAgentRuntimeState()
  if (!agentService || !agentServiceConfig) {
    console.log('[API] No API key configured. Agent service will be available after settings are saved.')
    console.log('[API] Please configure your API key in the Settings page.\n')
    return
  }

  if (getActiveProviderConfig()?.apiKey) {
    console.log('[API] Using active provider from saved settings')
  } else {
    logConfig()
  }

  const skillsEnabled = agentServiceConfig.skills?.enabled !== false
  console.log(
    `[API] Agent service initialized with provider: ${agentServiceConfig.provider.provider}, model: ${agentServiceConfig.provider.model}, skills: ${skillsEnabled ? 'enabled' : 'disabled'}, mcp: ${agentServiceConfig.mcp ? 'enabled' : 'disabled'}\n`
  )
}
