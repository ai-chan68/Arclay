/**
 * Sandbox API routes
 */

import { Hono } from 'hono'
import { extname } from 'node:path'
import { SandboxService } from '../core/sandbox/sandbox-service'
import type { SandboxResult } from '@shared-types'

// Sandbox service instance (will be injected)
let sandboxService: SandboxService | null = null

/**
 * Set the sandbox service instance
 */
export function setSandboxService(service: SandboxService): void {
  sandboxService = service
}

/**
 * Get the sandbox service instance
 */
export function getSandboxService(): SandboxService | null {
  return sandboxService
}

export const sandboxRoutes = new Hono()

type ExecutionClassification =
  | 'succeeded'
  | 'timed_out'
  | 'started_with_timeout'
  | 'failed'

interface ExecutionSummary {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  duration: number
  classification: ExecutionClassification
  started: boolean
  healthPassed: boolean | null
  healthUrl: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeHealthUrl(url: string): string {
  return url.replace('://0.0.0.0', '://127.0.0.1')
}

function extractLocalHttpUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/[^\s]*)?/i)
  return match ? normalizeHealthUrl(match[0]) : null
}

function hasServerStartupSignal(output: string): boolean {
  const patterns = [
    /vite\s+v\d/i,
    /\bready in\b/i,
    /\blocal:\s+https?:\/\//i,
    /\bserving\b/i,
    /\blistening\b/i,
    /\brunning on\s+https?:\/\//i,
    /\bserver started\b/i,
    /\bstarted with pid\b/i,
  ]
  return patterns.some((pattern) => pattern.test(output))
}

async function checkHttpHealth(url: string, attempts = 2): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), 2500)

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal })
      if (response.ok) return true
    } catch {
      // ignore and retry
    } finally {
      clearTimeout(timeoutHandle)
    }

    if (attempt < attempts - 1) {
      await sleep(800)
    }
  }

  return false
}

async function summarizeExecutionResult(result: SandboxResult, duration: number): Promise<ExecutionSummary> {
  const timedOut = Boolean(result.timedOut)
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  const startupDetected = timedOut && hasServerStartupSignal(combinedOutput)

  let healthUrl: string | null = null
  let healthPassed: boolean | null = null
  let classification: ExecutionClassification = 'failed'
  let success = false

  if (!timedOut && result.exitCode === 0) {
    classification = 'succeeded'
    success = true
  } else if (timedOut) {
    classification = 'timed_out'

    if (startupDetected) {
      healthUrl = extractLocalHttpUrl(combinedOutput)
      if (healthUrl) {
        healthPassed = await checkHttpHealth(healthUrl, 2)
      } else {
        healthPassed = false
      }

      if (healthPassed) {
        classification = 'started_with_timeout'
        success = true
      }
    }
  }

  return {
    success,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut,
    duration,
    classification,
    started: startupDetected,
    healthPassed,
    healthUrl,
  }
}

function shellEscape(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildCommand(command: string, args?: string[]): string {
  const normalizedArgs = Array.isArray(args)
    ? args.filter((item) => typeof item === 'string')
    : []
  if (normalizedArgs.length === 0) return command
  return `${command} ${normalizedArgs.map(shellEscape).join(' ')}`
}

function detectScriptRuntime(filePath: string): { runtime: string; command: string } {
  const ext = extname(filePath).toLowerCase()

  switch (ext) {
    case '.py':
      return { runtime: 'python3', command: 'python3' }
    case '.js':
    case '.mjs':
    case '.cjs':
      return { runtime: 'node', command: 'node' }
    case '.ts':
    case '.mts':
    case '.cts':
      return { runtime: 'tsx', command: 'tsx' }
    case '.sh':
      return { runtime: 'sh', command: 'sh' }
    case '.bash':
      return { runtime: 'bash', command: 'bash' }
    case '.zsh':
      return { runtime: 'zsh', command: 'zsh' }
    default:
      return { runtime: 'sh', command: 'sh' }
  }
}

async function executeCommand(payload: {
  command?: string
  args?: string[]
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}) {
  if (!sandboxService) {
    return { status: 500 as const, body: { error: 'Sandbox service not initialized' } }
  }

  const { command, args, cwd, timeout, env } = payload
  if (!command || typeof command !== 'string') {
    return { status: 400 as const, body: { error: 'command is required' } }
  }

  const commandToRun = buildCommand(command, args)
  const startAt = Date.now()
  const result = await sandboxService.execute(commandToRun, { cwd, timeout, env })
  const duration = Date.now() - startAt
  const summary = await summarizeExecutionResult(result, duration)

  return {
    status: 200 as const,
    body: {
      ...summary,
      provider: sandboxService.getProviderName(),
      fallbackFrom: sandboxService.getSelection().fallbackFrom || null,
    },
  }
}

/**
 * POST /api/sandbox/execute - Execute a command
 */
sandboxRoutes.post('/execute', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const result = await executeCommand(body as {
      command?: string
      args?: string[]
      cwd?: string
      timeout?: number
      env?: Record<string, string>
    })
    return c.json(result.body, result.status)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/sandbox/exec - Execute a command (compat route for Claude sandbox MCP)
 */
sandboxRoutes.post('/exec', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const result = await executeCommand(body as {
      command?: string
      args?: string[]
      cwd?: string
      timeout?: number
      env?: Record<string, string>
    })
    return c.json(result.body, result.status)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/sandbox/run/file - Run a script file (compat route for Claude sandbox MCP)
 */
sandboxRoutes.post('/run/file', async (c) => {
  if (!sandboxService) {
    return c.json({ error: 'Sandbox service not initialized' }, 500)
  }

  try {
    const body = await c.req.json().catch(() => ({}))
    const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : ''
    const workDir = typeof body.workDir === 'string' ? body.workDir : undefined
    const args = Array.isArray(body.args) ? body.args.filter((arg: unknown): arg is string => typeof arg === 'string') : []
    const timeout = typeof body.timeout === 'number' ? body.timeout : undefined

    if (!filePath) {
      return c.json({ error: 'filePath is required' }, 400)
    }

    const runtime = detectScriptRuntime(filePath)
    const command = `${runtime.command} ${shellEscape(filePath)}${args.length > 0 ? ` ${args.map(shellEscape).join(' ')}` : ''}`
    const startAt = Date.now()
    const result = await sandboxService.execute(command, {
      cwd: workDir,
      timeout,
    })
    const duration = Date.now() - startAt
    const summary = await summarizeExecutionResult(result, duration)

    return c.json({
      ...summary,
      runtime: runtime.runtime,
      provider: sandboxService.getProviderName(),
      fallbackFrom: sandboxService.getSelection().fallbackFrom || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/sandbox/read - Read a file
 */
sandboxRoutes.post('/read', async (c) => {
  if (!sandboxService) {
    return c.json({ error: 'Sandbox service not initialized' }, 500)
  }

  const body = await c.req.json().catch(() => ({}))
  const { path, encoding } = body

  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }

  try {
    const content = await sandboxService.readFile(path, encoding)
    return c.json({ success: true, content })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/sandbox/write - Write a file
 */
sandboxRoutes.post('/write', async (c) => {
  if (!sandboxService) {
    return c.json({ error: 'Sandbox service not initialized' }, 500)
  }

  const body = await c.req.json().catch(() => ({}))
  const { path, content, mode } = body

  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }

  if (content === undefined) {
    return c.json({ error: 'content is required' }, 400)
  }

  try {
    await sandboxService.writeFile(path, content, { mode })
    return c.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/sandbox/list - List directory contents
 */
sandboxRoutes.post('/list', async (c) => {
  if (!sandboxService) {
    return c.json({ error: 'Sandbox service not initialized' }, 500)
  }

  const body = await c.req.json().catch(() => ({}))
  const { path } = body

  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }

  try {
    const files = await sandboxService.listDir(path)
    return c.json({ success: true, files })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/sandbox/exists - Check if file exists
 */
sandboxRoutes.post('/exists', async (c) => {
  if (!sandboxService) {
    return c.json({ error: 'Sandbox service not initialized' }, 500)
  }

  const body = await c.req.json().catch(() => ({}))
  const { path } = body

  if (!path) {
    return c.json({ error: 'path is required' }, 400)
  }

  try {
    const exists = await sandboxService.exists(path)
    return c.json({ success: true, exists })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})
