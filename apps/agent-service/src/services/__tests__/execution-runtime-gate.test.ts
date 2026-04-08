import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared-types'
import {
  buildRuntimeRepairPrompt,
  collectExecutionObservation,
  createExecutionObservation,
  evaluateRuntimeGate,
} from '../execution-runtime-gate'

describe('execution-runtime-gate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('collects command, url, port, and health-pass evidence into the observation', () => {
    const observation = createExecutionObservation()

    const toolUseMessage: AgentMessage = {
      id: 'tool_use_dev',
      type: 'tool_use',
      toolName: 'sandbox_run_command',
      toolInput: {
        command: 'pnpm',
        args: ['run', 'dev', '--port', '3210'],
      },
      timestamp: 1,
    }
    const toolResultMessage: AgentMessage = {
      id: 'tool_result_dev',
      type: 'tool_result',
      toolOutput: 'VITE ready at http://0.0.0.0:3210/\nHealth check: passed (http://127.0.0.1:3210)',
      timestamp: 2,
    }

    collectExecutionObservation(toolUseMessage, observation)
    collectExecutionObservation(toolResultMessage, observation)

    expect(observation.commands).toEqual(['pnpm run dev --port 3210'])
    expect([...observation.discoveredUrls]).toContain('http://127.0.0.1:3210/')
    expect([...observation.passedHealthUrls]).toContain('http://127.0.0.1:3210')
    expect([...observation.portHints]).toContain(3210)
    expect(observation.frontendCommandCount).toBe(1)
    expect(observation.backendCommandCount).toBe(0)
  })

  it('fails runtime gate when expected frontend/backend endpoints are not healthy', async () => {
    const observation = createExecutionObservation()
    observation.frontendCommandCount = 1
    observation.backendCommandCount = 1
    observation.discoveredUrls.add('http://127.0.0.1:3000')
    observation.discoveredUrls.add('http://127.0.0.1:5001/api/health')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(':3000')) {
        return new Response('ok', { status: 200 })
      }
      return new Response('nope', { status: 503 })
    })

    const result = await evaluateRuntimeGate(observation, '/tmp/project')

    expect(result.passed).toBe(false)
    expect(result.reason).toContain('Backend server did not pass health check')
    expect(result.frontendHealthy).toBe(true)
    expect(result.backendHealthy).toBe(false)
    expect(result.previewUrl).toBe('http://127.0.0.1:3000')
  })

  it('excludes internal Arclay ports for session workspace runtime checks', async () => {
    const observation = createExecutionObservation()
    observation.discoveredUrls.add('http://127.0.0.1:1420')
    observation.discoveredUrls.add('http://127.0.0.1:2026/api/health')
    observation.discoveredUrls.add('http://127.0.0.1:3210')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const result = await evaluateRuntimeGate(
      observation,
      '/Users/chanyun/ai/easeWork/workspace/sessions/task_runtime_gate'
    )

    expect(result.checkedUrls).toEqual(['http://127.0.0.1:3210'])
    expect(result.healthyUrls).toEqual(['http://127.0.0.1:3210'])
    expect(result.passed).toBe(true)
  })

  it('builds a repair prompt with checked and healthy runtime urls', () => {
    const prompt = buildRuntimeRepairPrompt(
      'Execute the plan',
      {
        passed: false,
        reason: 'Frontend server did not pass health check after execution.',
        checkedUrls: ['http://127.0.0.1:3000', 'http://127.0.0.1:5001/api/health'],
        healthyUrls: ['http://127.0.0.1:5001/api/health'],
        previewUrl: null,
        frontendExpected: true,
        frontendHealthy: false,
        backendExpected: true,
        backendHealthy: true,
      },
      '/tmp/project'
    )

    expect(prompt).toContain('Automatic Runtime Repair Required')
    expect(prompt).toContain('Frontend server did not pass health check after execution.')
    expect(prompt).toContain('http://127.0.0.1:3000')
    expect(prompt).toContain('http://127.0.0.1:5001/api/health')
    expect(prompt).toContain('Do not finish until verification endpoints return HTTP 200.')
  })

  it('passes runtime gate for static_files deliverable with no port conflicts', async () => {
    const observation = createExecutionObservation()
    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'static_files')

    expect(result.passed).toBe(true)
    expect(result.reason).toContain('Static deliverable type')
  })

  it('passes runtime gate for data_output deliverable', async () => {
    const observation = createExecutionObservation()
    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'data_output')

    expect(result.passed).toBe(true)
  })

  it('passes runtime gate for script_execution deliverable', async () => {
    const observation = createExecutionObservation()
    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'script_execution')

    expect(result.passed).toBe(true)
  })

  it('fails static deliverable if port conflicts exist', async () => {
    const observation = createExecutionObservation()
    observation.portConflicts.push('port 3000 is already in use')

    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'static_files')

    expect(result.passed).toBe(false)
  })

  it('detects backend start commands', () => {
    const observation = createExecutionObservation()

    const flaskMessage: AgentMessage = {
      id: 'flask',
      type: 'tool_use',
      toolName: 'bash',
      toolInput: { command: 'flask run' },
      timestamp: 1,
    }
    collectExecutionObservation(flaskMessage, observation)
    expect(observation.backendCommandCount).toBe(1)

    const uvicornMessage: AgentMessage = {
      id: 'uvicorn',
      type: 'tool_use',
      toolName: 'bash',
      toolInput: { command: 'uvicorn main:app' },
      timestamp: 2,
    }
    collectExecutionObservation(uvicornMessage, observation)
    expect(observation.backendCommandCount).toBe(2)
  })

  it('detects port conflicts from tool output', () => {
    const observation = createExecutionObservation()

    const conflictMessage: AgentMessage = {
      id: 'conflict',
      type: 'tool_result',
      toolOutput: 'Error: address already in use',
      timestamp: 1,
    }
    collectExecutionObservation(conflictMessage, observation)

    expect(observation.portConflicts.length).toBe(1)
    expect(observation.portConflicts[0]).toContain('address already in use')
  })

  it('normalizes URLs with trailing punctuation', () => {
    const observation = createExecutionObservation()

    const message: AgentMessage = {
      id: 'url',
      type: 'tool_result',
      toolOutput: 'Server at http://localhost:3000), ready.',
      timestamp: 1,
    }
    collectExecutionObservation(message, observation)

    expect([...observation.discoveredUrls]).toContain('http://localhost:3000')
  })

  it('collects port hints from environment variables', () => {
    const observation = createExecutionObservation()

    const message: AgentMessage = {
      id: 'env',
      type: 'tool_result',
      toolOutput: 'Starting with PORT=8080',
      timestamp: 1,
    }
    collectExecutionObservation(message, observation)

    expect([...observation.portHints]).toContain(8080)
  })

  it('uses default frontend ports when no hints found', async () => {
    const observation = createExecutionObservation()
    observation.frontendCommandCount = 1

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'local_service')

    expect(result.checkedUrls.some(url => url.includes('5173'))).toBe(true)
    expect(result.checkedUrls.some(url => url.includes('5174'))).toBe(true)
  })

  it('uses default backend port when no hints found', async () => {
    const observation = createExecutionObservation()
    observation.backendCommandCount = 1

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'local_service')

    expect(result.checkedUrls.some(url => url.includes('5001/api/health'))).toBe(true)
  })

  it('handles fetch errors gracefully', async () => {
    const observation = createExecutionObservation()
    observation.discoveredUrls.add('http://localhost:9999')

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

    const result = await evaluateRuntimeGate(observation, '/tmp/project', 'local_service')

    expect(result.passed).toBe(false)
    expect(result.healthyUrls).toEqual([])
  })

  it('handles empty URLs in repair prompt', () => {
    const prompt = buildRuntimeRepairPrompt(
      'Execute',
      {
        passed: false,
        reason: 'No healthy endpoint',
        checkedUrls: [],
        healthyUrls: [],
        previewUrl: null,
        frontendExpected: false,
        frontendHealthy: false,
        backendExpected: false,
        backendHealthy: false,
      },
      '/tmp'
    )

    expect(prompt).toContain('Checked URLs: (none)')
    expect(prompt).toContain('Healthy URLs: (none)')
  })
})
