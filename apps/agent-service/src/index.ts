import { createLogger } from './shared/logger'
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
import { startSettingsWatcher, stopSettingsWatcher } from './settings-watcher'
import { homedir, platform } from 'os'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'

const log = createLogger('server')

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
  log.info('Extended PATH for Tauri sidecar environment')
}

// Initialize agent providers
initializeProviders()

// Initialize provider manager and wait for it to complete
providerManager.initialize()
  .then(() => {
    log.info('Provider manager initialized')
  })
  .catch((error) => {
    log.error(error, 'Failed to initialize provider manager')
  })

const runtime = createAppRuntime()
startSettingsWatcher({
  getAgentRuntimeState: runtime.getAgentRuntimeState,
  setAgentRuntimeState: runtime.setAgentRuntimeState,
  workDir: runtime.workDir,
})
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
  logInfo: log.info.bind(log),
})

function initializeSandboxServices(): Promise<void> {
  return runtime.initializeSandboxServices().then((sandboxService) => {
      setSandboxService(sandboxService)
      setPreviewSandboxService(sandboxService)
  })
}

void initializeSandboxServices().catch((error) => {
  log.error(error, 'Failed to initialize sandbox service')
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
  log.error(err, 'Server error')
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

  // Keep as console.log — Tauri sidecar Rust parser uses regex to extract the port from this exact line format
  console.log(`\nAPI server running on http://localhost:${port}`)
  if (isTauriSidecar) {
    log.info('Running as Tauri sidecar')
  }
  log.info('Press Ctrl+C to stop')

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
        log.error(err, 'Server error')
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })()
  })

  server.listen(port)
  scheduledTaskScheduler.start()

  // Graceful shutdown for sidecar
  const shutdown = () => {
    log.info('Shutting down gracefully...')
    stopSettingsWatcher()
    scheduledTaskScheduler.stop()
    approvalCoordinator.stopLifecycleSweep()
    planStore.stopLifecycleSweep()
    server.close(() => {
      log.info('Server closed')
      process.exit(0)
    })

    // Force exit after 10 seconds
    setTimeout(() => {
      log.warn('Forcing exit...')
      process.exit(1)
    }, 10000)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return port
}

if (typeof process !== 'undefined' && !process.env.VITEST) {
  startServer().catch((err) => log.error(err, 'Failed to start server'))
}

export { app }

function logInitialAgentRuntime(): void {
  const { agentService, agentServiceConfig } = runtime.getAgentRuntimeState()
  if (!agentService || !agentServiceConfig) {
    log.info('No API key configured. Agent service will be available after settings are saved.')
    log.info('Please configure your API key in the Settings page.')
    return
  }

  if (getActiveProviderConfig()?.apiKey) {
    log.info('Using active provider from saved settings')
  } else {
    logConfig()
  }

  const skillsEnabled = agentServiceConfig.skills?.enabled !== false
  log.info(
    {
      provider: agentServiceConfig.provider.provider,
      model: agentServiceConfig.provider.model,
      skills: skillsEnabled ? 'enabled' : 'disabled',
      mcp: agentServiceConfig.mcp ? 'enabled' : 'disabled',
    },
    'Agent service initialized'
  )
}
