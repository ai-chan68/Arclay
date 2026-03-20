import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAgent } from './claude'
import type { McpConfig } from '../types'

describe('Claude sandbox enforcement', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('denies Bash when sandbox is enabled', async () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const handler = (agent as unknown as {
      createPermissionHandler: (
        options?: {
          sandbox?: { enabled: boolean }
          taskId?: string
        },
        providerSessionId?: string
      ) => (
        toolName: string,
        input: Record<string, unknown>,
        permissionOptions: { toolUseID?: string; signal: AbortSignal }
      ) => Promise<{
        behavior: 'allow' | 'deny'
        message?: string
        interrupt?: boolean
        toolUseID?: string
      }>
    }).createPermissionHandler(
      {
        sandbox: { enabled: true },
        taskId: 'task-1',
      },
      'provider-session-1'
    )

    const result = await handler(
      'Bash',
      { command: 'pnpm start:clean' },
      {
        toolUseID: 'tool-1',
        signal: new AbortController().signal,
      }
    )

    expect(result.behavior).toBe('deny')
    expect(result.interrupt).toBe(false)
    expect(result.message).toContain('sandbox_run_command')
  })

  it('treats sandbox tool aliases as auto-allow equivalent', () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const shouldAutoAllowTool = (toolName: string, autoAllowTools: Set<string>) =>
      (agent as unknown as {
        shouldAutoAllowTool: (toolName: string, autoAllowTools: Set<string>) => boolean
      }).shouldAutoAllowTool(toolName, autoAllowTools)

    expect(
      shouldAutoAllowTool('sandbox_run_command', new Set(['mcp__sandbox__sandbox_run_command']))
    ).toBe(true)
    expect(
      shouldAutoAllowTool('mcp__sandbox__sandbox_run_command', new Set(['sandbox_run_command']))
    ).toBe(true)
    expect(
      shouldAutoAllowTool('sandbox_run_script', new Set(['mcp__sandbox__sandbox_run_script']))
    ).toBe(true)
    expect(
      shouldAutoAllowTool('mcp__sandbox__sandbox_run_script', new Set(['sandbox_run_script']))
    ).toBe(true)
  })

  it('auto-allows tools exposed by configured MCP servers', async () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const handler = (agent as unknown as {
      createPermissionHandler: (
        options?: {
          mcpConfig?: McpConfig
          taskId?: string
        },
        providerSessionId?: string
      ) => (
        toolName: string,
        input: Record<string, unknown>,
        permissionOptions: { toolUseID?: string; signal: AbortSignal }
      ) => Promise<{
        behavior: 'allow' | 'deny'
        message?: string
        interrupt?: boolean
        toolUseID?: string
      }>
    }).createPermissionHandler(
      {
        mcpConfig: {
          enabled: true,
          userDirEnabled: false,
          appDirEnabled: false,
          mcpServers: {
            feishu: {
              type: 'sse',
              url: 'https://open.feishu.cn/mcp/stream/demo',
            },
          },
        },
        taskId: 'task-mcp',
      },
      'provider-session-mcp'
    )

    const allowed = await handler(
      'mcp__feishu__search_docs',
      {},
      {
        toolUseID: 'tool-feishu',
        signal: new AbortController().signal,
      }
    )

    expect(allowed.behavior).toBe('allow')

    const pending = handler(
      'mcp__unknown__search_docs',
      {},
      {
        toolUseID: 'tool-unknown',
        signal: new AbortController().signal,
      }
    )

    await expect(Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])).resolves.toBe('pending')

    const denied = await handler(
      'mcp__unknown__search_docs',
      {},
      {
        toolUseID: 'tool-unknown-abort',
        signal: AbortSignal.abort(),
      }
    )

    expect(denied.behavior).toBe('deny')
    expect(denied.message).toContain('aborted')
  })

  it('auto-allows Skill invocations based on skill configuration rather than approval policy', async () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const handler = (agent as unknown as {
      createPermissionHandler: (
        options?: {
          taskId?: string
        },
        providerSessionId?: string
      ) => (
        toolName: string,
        input: Record<string, unknown>,
        permissionOptions: { toolUseID?: string; signal: AbortSignal }
      ) => Promise<{
        behavior: 'allow' | 'deny'
        message?: string
        interrupt?: boolean
        toolUseID?: string
      }>
    }).createPermissionHandler(
      {
        taskId: 'task-skill',
      },
      'provider-session-skill'
    )

    const result = await handler(
      'Skill',
      {
        skill: 'playwright-cli',
        args: 'navigate https://example.com',
      },
      {
        toolUseID: 'tool-skill',
        signal: new AbortController().signal,
      }
    )

    expect(result.behavior).toBe('allow')
    expect(result.interrupt).toBeUndefined()
  })

  it('keeps sandbox MCP tools under permission control when not explicitly auto-allowed', async () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    const handler = (agent as unknown as {
      createPermissionHandler: (
        options?: {
          taskId?: string
        },
        providerSessionId?: string
      ) => (
        toolName: string,
        input: Record<string, unknown>,
        permissionOptions: { toolUseID?: string; signal: AbortSignal }
      ) => Promise<{
        behavior: 'allow' | 'deny'
        message?: string
        interrupt?: boolean
        toolUseID?: string
      }>
    }).createPermissionHandler(
      {
        taskId: 'task-sandbox-mcp',
      },
      'provider-session-sandbox-mcp'
    )

    const pending = handler(
      'mcp__sandbox__sandbox_run_command',
      { command: 'echo hello' },
      {
        toolUseID: 'tool-sandbox-mcp',
        signal: new AbortController().signal,
      }
    )

    await expect(Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])).resolves.toBe('pending')

    const denied = await handler(
      'mcp__sandbox__sandbox_run_command',
      { command: 'echo hello' },
      {
        toolUseID: 'tool-sandbox-mcp-abort',
        signal: AbortSignal.abort(),
      }
    )

    expect(denied.behavior).toBe('deny')
    expect(denied.message).toContain('aborted')
  })

  it('denies file writes outside the session work directory', async () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })
    vi.spyOn(agent as any, 'getApprovalPolicy').mockReturnValue({
      enabled: false,
      autoAllowTools: new Set<string>(),
      timeoutMs: 1_000,
    })

    const handler = (agent as unknown as {
      createPermissionHandler: (
        options?: {
          cwd?: string
          taskId?: string
        },
        providerSessionId?: string
      ) => (
        toolName: string,
        input: Record<string, unknown>,
        permissionOptions: { toolUseID?: string; signal: AbortSignal }
      ) => Promise<{
        behavior: 'allow' | 'deny'
        message?: string
        interrupt?: boolean
        toolUseID?: string
      }>
    }).createPermissionHandler(
      {
        cwd: '/tmp/easywork',
        taskId: 'task-1',
      },
      'provider-session-write-scope'
    )

    const outsideResult = await handler(
      'Write',
      {
        file_path: '/tmp/easywork/result.txt',
        content: 'bad path',
      },
      {
        toolUseID: 'tool-write-outside',
        signal: new AbortController().signal,
      }
    )

    expect(outsideResult.behavior).toBe('deny')
    expect(outsideResult.interrupt).toBe(false)
    expect(outsideResult.message).toContain('/tmp/easywork/sessions/task-1')

    const insideResult = await handler(
      'Write',
      {
        file_path: '/tmp/easywork/sessions/task-1/result.txt',
        content: 'good path',
      },
      {
        toolUseID: 'tool-write-inside',
        signal: new AbortController().signal,
      }
    )

    expect(insideResult.behavior).toBe('allow')
  })
})
