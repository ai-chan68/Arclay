import { describe, expect, it, vi } from 'vitest'
import { BashTool } from './bash'
import type { SandboxService } from '../sandbox/sandbox-service'

function makeSandbox(overrides: {
  stdout?: string
  stderr?: string
  exitCode?: number
  timedOut?: boolean
} = {}) {
  return {
    execute: vi.fn().mockResolvedValue({
      stdout: 'hello',
      stderr: 'warning: something',
      exitCode: 0,
      timedOut: false,
      ...overrides,
    }),
    exists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listFiles: vi.fn(),
  } as unknown as SandboxService
}

describe('BashTool stderr handling', () => {
  it('returns warning status when stderr is present but exit code is 0', async () => {
    const tool = new BashTool(makeSandbox())
    const result = await tool.execute({ command: 'echo hello' })
    expect(result.success).toBe(true)
    expect(result.status).toBe('warning')
    expect(result.output).toBe('hello')
    expect(result.summary).toBe('Command completed with warnings (exit code 0)')
    expect(result.error).toBe('warning: something')
    expect(result.output).not.toContain('stderr')
    expect(result.output).not.toContain('warning')
  })

  it('returns structured error contract when exit code is nonzero', async () => {
    const tool = new BashTool(makeSandbox({ stdout: '', stderr: 'command not found', exitCode: 127 }))
    const result = await tool.execute({ command: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.status).toBe('error')
    expect(result.summary).toBe('Command failed with exit code 127')
    expect(result.error).toBe('[root] exit code 127: command not found | [retry] check command syntax | [stop] if same error repeats')
    expect(result.output).toBe('(no output)')
  })

  it('returns success status when stderr is empty', async () => {
    const tool = new BashTool(makeSandbox({ stderr: '' }))
    const result = await tool.execute({ command: 'echo hi' })
    expect(result.status).toBe('success')
    expect(result.summary).toBe('Command succeeded with exit code 0')
    expect(result.error).toBeUndefined()
  })

  it('returns structured timeout contract when timedOut is true and stderr is empty', async () => {
    const tool = new BashTool(makeSandbox({ stdout: '', stderr: '', exitCode: -1, timedOut: true }))
    const result = await tool.execute({ command: 'sleep 999', timeout: 5000 } as Record<string, unknown>)
    expect(result.success).toBe(false)
    expect(result.status).toBe('error')
    expect(result.summary).toBe('Command timed out after 5000ms')
    expect(result.error).toBe('[root] timed out after 5000ms | [retry] reduce scope or increase timeout | [stop] after 3 retries')
  })

  it('prefers the timeout contract even when stderr is non-empty', async () => {
    const tool = new BashTool(makeSandbox({ stdout: '', stderr: 'partial output', exitCode: -1, timedOut: true }))
    const result = await tool.execute({ command: 'sleep 999', timeout: 5000 } as Record<string, unknown>)
    expect(result.success).toBe(false)
    expect(result.status).toBe('error')
    expect(result.error).toBe('[root] timed out after 5000ms | [retry] reduce scope or increase timeout | [stop] after 3 retries')
  })

  it('maps ENOENT failures to a command-not-found recovery contract', async () => {
    const sandbox = {
      execute: vi.fn().mockRejectedValue(new Error('spawn git ENOENT')),
      exists: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      listFiles: vi.fn(),
    } as unknown as SandboxService

    const tool = new BashTool(sandbox)
    const result = await tool.execute({ command: 'git status' })

    expect(result.success).toBe(false)
    expect(result.status).toBe('error')
    expect(result.summary).toBe('Command failed: git is not installed')
    expect(result.error).toBe('[root] command not found: git | [retry] install via brew/apt | [stop] immediately')
  })
})
