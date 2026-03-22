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

  it('excludes internal easywork ports for session workspace runtime checks', async () => {
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
})
