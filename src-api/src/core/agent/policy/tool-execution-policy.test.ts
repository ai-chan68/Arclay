import { describe, expect, it } from 'vitest'
import { evaluateToolExecutionPolicy } from './tool-execution-policy'

describe('tool execution policy', () => {
  it('denies host Bash when sandbox mode is enabled', () => {
    const result = evaluateToolExecutionPolicy({
      toolName: 'Bash',
      input: { command: 'ls' },
      sandboxEnabled: true,
      sessionDir: '/tmp/session',
      approvalEnabled: true,
      autoAllowTools: new Set(),
      configuredMcpServers: [],
    })
    expect(result.decision).toBe('deny')
    expect(result.reason).toContain('Sandbox mode is enabled')
  })

  it('denies Write outside sessionDir when approval is enabled', () => {
    const result = evaluateToolExecutionPolicy({
      toolName: 'Write',
      input: { file_path: '/etc/passwd', content: 'hack' },
      sandboxEnabled: false,
      sessionDir: '/Users/test/project',
      approvalEnabled: true,
      autoAllowTools: new Set(),
      configuredMcpServers: [],
    })
    expect(result.decision).toBe('deny')
    expect(result.reason).toContain('outside the session directory')
  })

  it('allows mcp tool when configured in mcp servers', () => {
    const result = evaluateToolExecutionPolicy({
      toolName: 'mcp__feishu__search_docs',
      input: { query: 'test' },
      sandboxEnabled: false,
      sessionDir: '/tmp/session',
      approvalEnabled: true,
      autoAllowTools: new Set(),
      configuredMcpServers: ['feishu'],
    })
    expect(result.decision).toBe('allow')
  })

  it('requires approval for Bash when sandbox is disabled and not auto-allowed', () => {
    const result = evaluateToolExecutionPolicy({
      toolName: 'Bash',
      input: { command: 'ls' },
      sandboxEnabled: false,
      sessionDir: '/tmp/session',
      approvalEnabled: true,
      autoAllowTools: new Set(),
      configuredMcpServers: [],
    })
    expect(result.decision).toBe('require_approval')
  })
})
