import type { AgentMessage } from '@shared-types'
import { parseToolOutputText } from './execution-stream-processing'

export interface ExecutionObservation {
  commands: string[]
  discoveredUrls: Set<string>
  passedHealthUrls: Set<string>
  portHints: Set<number>
  frontendCommandCount: number
  backendCommandCount: number
  portConflicts: string[]
}

export interface RuntimeGateResult {
  passed: boolean
  reason: string
  checkedUrls: string[]
  healthyUrls: string[]
  previewUrl: string | null
  frontendExpected: boolean
  frontendHealthy: boolean
  backendExpected: boolean
  backendHealthy: boolean
}

const EASYWORK_INTERNAL_PORTS = new Set([1420, 2026, 2027])

export function createExecutionObservation(): ExecutionObservation {
  return {
    commands: [],
    discoveredUrls: new Set<string>(),
    passedHealthUrls: new Set<string>(),
    portHints: new Set<number>(),
    frontendCommandCount: 0,
    backendCommandCount: 0,
    portConflicts: [],
  }
}

function normalizeLoopbackUrl(rawUrl: string): string {
  return rawUrl
    .replace('://0.0.0.0', '://127.0.0.1')
    .replace(/[),.;\]}>]+$/, '')
}

function extractLoopbackUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}(?:\/[^\s"')\]}]*)?/gi) || []
  return Array.from(new Set(matches.map(normalizeLoopbackUrl)))
}

function isFrontendStartCommand(command: string): boolean {
  const lower = command.toLowerCase()
  return (
    /\b(vite|next dev|nuxt dev|webpack serve)\b/.test(lower) ||
    /\b(npm|pnpm|yarn)\s+run\s+dev\b/.test(lower)
  )
}

function isBackendStartCommand(command: string): boolean {
  const lower = command.toLowerCase()
  return (
    /\b(flask run|uvicorn|gunicorn|python .*app\.py|node .*server)\b/.test(lower) ||
    /\b(npm|pnpm|yarn)\s+run\s+start(?::api)?\b/.test(lower)
  )
}

function collectPortHints(text: string, target: Set<number>): void {
  const hostPortRegex = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi
  const longFlagRegex = /--port\s+(\d{2,5})/gi
  const envRegex = /\bPORT=(\d{2,5})\b/g
  const fixedDefaults = [5001, 5173]

  for (const regex of [hostPortRegex, longFlagRegex, envRegex]) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const parsed = Number.parseInt(match[1], 10)
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
        target.add(parsed)
      }
    }
  }

  for (const port of fixedDefaults) {
    if (text.includes(String(port))) {
      target.add(port)
    }
  }
}

export function collectExecutionObservation(message: AgentMessage, observation: ExecutionObservation): void {
  if (message.type === 'tool_use') {
    const command = typeof message.toolInput?.command === 'string'
      ? message.toolInput.command
      : ''
    const args = Array.isArray(message.toolInput?.args)
      ? message.toolInput.args.filter((item): item is string => typeof item === 'string').join(' ')
      : ''
    const fullCommand = `${command}${args ? ` ${args}` : ''}`.trim()

    if (fullCommand) {
      observation.commands.push(fullCommand)
      for (const url of extractLoopbackUrls(fullCommand)) {
        observation.discoveredUrls.add(url)
      }
      collectPortHints(fullCommand, observation.portHints)
      if (isFrontendStartCommand(fullCommand)) observation.frontendCommandCount += 1
      if (isBackendStartCommand(fullCommand)) observation.backendCommandCount += 1
    }
    return
  }

  if (message.type !== 'tool_result' || typeof message.toolOutput !== 'string') {
    return
  }

  const text = parseToolOutputText(message.toolOutput)
  if (!text) return

  for (const url of extractLoopbackUrls(text)) {
    observation.discoveredUrls.add(url)
  }
  collectPortHints(text, observation.portHints)

  const healthPassMatches = text.matchAll(/Health check:\s*passed(?:\s*\((https?:\/\/[^)\s]+)\))?/gi)
  for (const match of healthPassMatches) {
    const candidate = typeof match[1] === 'string' ? match[1] : ''
    if (candidate) {
      observation.passedHealthUrls.add(normalizeLoopbackUrl(candidate))
    }
  }

  if (/port\s+\d+\s+is already in use/i.test(text) || /address already in use/i.test(text)) {
    observation.portConflicts.push(text)
  }
}

function buildUrlCandidates(observation: ExecutionObservation): string[] {
  const candidates = new Set<string>()

  for (const url of observation.discoveredUrls) {
    candidates.add(url)
  }

  for (const url of observation.passedHealthUrls) {
    candidates.add(url)
  }

  for (const port of observation.portHints) {
    candidates.add(`http://127.0.0.1:${port}`)
    candidates.add(`http://127.0.0.1:${port}/api/health`)
  }

  if (observation.frontendCommandCount > 0 && observation.portHints.size === 0) {
    candidates.add('http://127.0.0.1:5173')
    candidates.add('http://127.0.0.1:5174')
  }

  if (observation.backendCommandCount > 0 && observation.portHints.size === 0) {
    candidates.add('http://127.0.0.1:5001/api/health')
  }

  return [...candidates]
}

function isSessionWorkspaceWorkDir(workDir: string): boolean {
  const normalized = workDir.replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/workspace/sessions/')
}

function shouldExcludeRuntimeUrl(url: string, workDir: string): boolean {
  if (!isSessionWorkspaceWorkDir(workDir)) return false
  try {
    const parsed = new URL(url)
    const port = Number.parseInt(parsed.port, 10)
    if (!Number.isFinite(port)) return false
    return EASYWORK_INTERNAL_PORTS.has(port)
  } catch {
    return false
  }
}

async function probeUrlHealth(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export async function evaluateRuntimeGate(
  observation: ExecutionObservation,
  workDir: string
): Promise<RuntimeGateResult> {
  const candidates = buildUrlCandidates(observation)
    .filter((url) => !shouldExcludeRuntimeUrl(url, workDir))
  const healthy: string[] = []

  for (const url of candidates) {
    if (await probeUrlHealth(url)) {
      healthy.push(url)
    }
  }

  const frontendExpected = observation.frontendCommandCount > 0
  const backendExpected = observation.backendCommandCount > 0
  const frontendHealthy = healthy.some((url) => {
    try {
      const parsed = new URL(url)
      return !parsed.pathname.startsWith('/api')
    } catch {
      return false
    }
  })
  const backendHealthy = healthy.some((url) => {
    try {
      const parsed = new URL(url)
      return parsed.pathname.startsWith('/api') || parsed.pathname.startsWith('/health')
    } catch {
      return false
    }
  })

  const hasAnyHealthy = healthy.length > 0
  let passed = true
  let reason = 'Runtime verification passed.'

  if (frontendExpected && !frontendHealthy) {
    passed = false
    reason = 'Frontend server did not pass health check after execution.'
  } else if (backendExpected && !backendHealthy) {
    passed = false
    reason = 'Backend server did not pass health check after execution.'
  } else if (!frontendExpected && !backendExpected && !hasAnyHealthy) {
    passed = false
    reason = 'No healthy local endpoint detected after run execution.'
  } else if (observation.portConflicts.length > 0 && !hasAnyHealthy) {
    passed = false
    reason = 'Port conflict detected and no healthy endpoint recovered.'
  }

  const previewUrl = frontendHealthy
    ? healthy.find((url) => {
        try {
          return !new URL(url).pathname.startsWith('/api')
        } catch {
          return false
        }
      }) || null
    : null

  return {
    passed,
    reason,
    checkedUrls: candidates,
    healthyUrls: healthy,
    previewUrl,
    frontendExpected,
    frontendHealthy,
    backendExpected,
    backendHealthy,
  }
}

export function buildRuntimeRepairPrompt(
  executionPrompt: string,
  gate: RuntimeGateResult,
  workDir: string
): string {
  const checked = gate.checkedUrls.length > 0 ? gate.checkedUrls.join(', ') : '(none)'
  const healthy = gate.healthyUrls.length > 0 ? gate.healthyUrls.join(', ') : '(none)'

  return `${executionPrompt}

## Automatic Runtime Repair Required

Previous execution did not satisfy runtime verification.
- Reason: ${gate.reason}
- Checked URLs: ${checked}
- Healthy URLs: ${healthy}
- Work dir: ${workDir}

You MUST self-repair now:
1. Detect and resolve port conflicts without killing unrelated processes.
2. Start required services in background using sandbox_run_command.
3. Run explicit health checks for backend and frontend endpoints.
4. Report the final reachable frontend preview URL and backend health URL.
5. Do not finish until verification endpoints return HTTP 200.`
}
