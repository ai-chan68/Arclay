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
  it('puts stdout in output and stderr in error field when exit code is 0', async () => {
    const tool = new BashTool(makeSandbox())
    const result = await tool.execute({ command: 'echo hello' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('hello')
    expect(result.error).toBe('warning: something')
    expect(result.output).not.toContain('stderr')
    expect(result.output).not.toContain('warning')
  })

  it('returns success false and stderr in error field when exit code is nonzero', async () => {
    const tool = new BashTool(makeSandbox({ stdout: '', stderr: 'command not found', exitCode: 127 }))
    const result = await tool.execute({ command: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('command not found')
    expect(result.output).toBe('(no output)')
  })

  it('sets error to undefined when stderr is empty', async () => {
    const tool = new BashTool(makeSandbox({ stderr: '' }))
    const result = await tool.execute({ command: 'echo hi' })
    expect(result.error).toBeUndefined()
  })

  it('includes timeout message in error when timedOut is true and stderr is empty', async () => {
    const tool = new BashTool(makeSandbox({ stdout: '', stderr: '', exitCode: -1, timedOut: true }))
    const result = await tool.execute({ command: 'sleep 999', timeout: 5000 } as Record<string, unknown>)
    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out after 5000ms')
  })

  it('includes both timeout message and stderr when timedOut is true and stderr is non-empty', async () => {
    const tool = new BashTool(makeSandbox({ stdout: '', stderr: 'partial output', exitCode: -1, timedOut: true }))
    const result = await tool.execute({ command: 'sleep 999', timeout: 5000 } as Record<string, unknown>)
    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out after 5000ms')
    expect(result.error).toContain('partial output')
  })
})
