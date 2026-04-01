import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolResult } from '@shared-types'
import { EditTool } from './edit'
import type { ITool, ToolContext } from './interface'
import { ReadTool } from './read'
import { ToolRegistry } from './registry'
import type { SandboxService } from '../sandbox/sandbox-service'
import { WriteTool } from './write'

function createSandbox(overrides: Partial<SandboxService> = {}): SandboxService {
  return {
    execute: vi.fn(),
    exists: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue('first\nsecond\nthird'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn(),
    ...overrides,
  } as unknown as SandboxService
}

describe('tool result metadata', () => {
  it('adds summary and artifacts to read results', async () => {
    const tool = new ReadTool(createSandbox())

    const result = await tool.execute({
      file_path: '/tmp/example.txt',
      offset: 2,
      limit: 1,
    })

    expect(result).toMatchObject({
      success: true,
      status: 'success',
      output: 'second',
      summary: 'Read 1 line from /tmp/example.txt',
      artifacts: ['/tmp/example.txt'],
    })
  })

  it('adds status, summary, and artifacts to write results', async () => {
    const sandbox = createSandbox()
    const tool = new WriteTool(sandbox)

    const result = await tool.execute({
      file_path: '/tmp/output.txt',
      content: 'hello',
    })

    expect(sandbox.writeFile).toHaveBeenCalledWith('/tmp/output.txt', 'hello')
    expect(result).toMatchObject({
      success: true,
      status: 'success',
      summary: 'Wrote 5 characters to /tmp/output.txt',
      artifacts: ['/tmp/output.txt'],
    })
  })

  it('adds status, summary, and artifacts to edit results', async () => {
    const sandbox = createSandbox({
      readFile: vi.fn().mockResolvedValue('hello world'),
    })
    const tool = new EditTool(sandbox)

    const result = await tool.execute({
      file_path: '/tmp/edit.txt',
      old_string: 'world',
      new_string: 'team',
    })

    expect(result).toMatchObject({
      success: true,
      status: 'success',
      summary: 'Edited /tmp/edit.txt (1 replacement)',
      artifacts: ['/tmp/edit.txt'],
    })
  })

  it('passes tool context through the registry to ITool implementations', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn<ITool['execute']>().mockResolvedValue({
      success: true,
      status: 'success',
    } as ToolResult)
    const tool: ITool = {
      definition: {
        name: 'fake',
        description: 'fake tool',
        parameters: { type: 'object' },
      } as ToolDefinition,
      execute,
    }
    const context: ToolContext = {
      workDir: '/tmp/workdir',
      sessionId: 'session-1',
      signal: new AbortController().signal,
    }

    registry.register(tool)
    await registry.execute('fake', { value: 1 }, context)

    expect(execute).toHaveBeenCalledWith({ value: 1 }, context)
  })
})
