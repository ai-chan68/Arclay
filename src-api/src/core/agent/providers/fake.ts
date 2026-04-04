/**
 * Fake Agent Provider
 * 用于集成测试和 E2E 测试，无需真实 LLM API
 *
 * 通过 providerConfig.scenario 选择预设场景：
 * - echo: 回显用户输入
 * - plan-and-execute: 返回计划 + 执行消息
 * - tool-use: 模拟 tool_use → tool_result 循环
 * - error: 模拟执行失败
 */

import type { AgentMessage, AgentSessionInfo } from '@shared-types'
import { BaseAgent } from '../base-agent'
import type {
  IAgentProvider,
  AgentProviderConfig,
  AgentRunOptions,
  AgentProviderType,
  AgentPlugin,
} from '../types'
import type { ProviderCapabilities, ProviderState } from '../../../shared/provider/types'

// ─── Scenario Types ───────────────────────────────────────────

export interface FakeScenario {
  readonly name: string
  readonly messages: readonly AgentMessage[]
  readonly delayMs?: number
}

type ScenarioName = 'echo' | 'plan-and-execute' | 'tool-use' | 'error'

// ─── Built-in Scenarios ───────────────────────────────────────

function createEchoScenario(prompt: string): FakeScenario {
  return {
    name: 'echo',
    messages: [
      {
        id: 'fake-text-1',
        type: 'text',
        role: 'assistant',
        content: `Echo: ${prompt}`,
        timestamp: Date.now(),
      },
      {
        id: 'fake-done',
        type: 'done',
        timestamp: Date.now(),
      },
    ],
  }
}

function createPlanAndExecuteScenario(): FakeScenario {
  return {
    name: 'plan-and-execute',
    messages: [
      {
        id: 'fake-plan-1',
        type: 'plan',
        role: 'assistant',
        timestamp: Date.now(),
        plan: {
          id: 'fake-plan',
          goal: '完成模拟任务',
          steps: [
            { id: 'step-1', description: '分析输入', status: 'pending' as const },
            { id: 'step-2', description: '生成结果', status: 'pending' as const },
          ],
          createdAt: new Date(),
        },
      },
      {
        id: 'fake-text-exec',
        type: 'text',
        role: 'assistant',
        content: '任务执行完成。',
        timestamp: Date.now(),
      },
      {
        id: 'fake-done',
        type: 'done',
        timestamp: Date.now(),
      },
    ],
  }
}

function createToolUseScenario(): FakeScenario {
  return {
    name: 'tool-use',
    messages: [
      {
        id: 'fake-tool-use-1',
        type: 'tool_use',
        role: 'assistant',
        toolName: 'bash',
        toolInput: { command: 'echo hello' },
        toolUseId: 'fake-tool-call-1',
        timestamp: Date.now(),
      },
      {
        id: 'fake-tool-result-1',
        type: 'tool_result',
        toolUseId: 'fake-tool-call-1',
        toolName: 'bash',
        toolOutput: JSON.stringify({
          status: 'success',
          summary: 'hello',
          next_actions: [],
          artifacts: [],
        }),
        timestamp: Date.now(),
      },
      {
        id: 'fake-text-summary',
        type: 'text',
        role: 'assistant',
        content: '工具执行完成，输出: hello',
        timestamp: Date.now(),
      },
      {
        id: 'fake-done',
        type: 'done',
        timestamp: Date.now(),
      },
    ],
  }
}

function createErrorScenario(): FakeScenario {
  return {
    name: 'error',
    messages: [
      {
        id: 'fake-error-1',
        type: 'error',
        errorMessage: 'Simulated execution failure for testing',
        timestamp: Date.now(),
      },
    ],
  }
}

function resolveScenario(name: ScenarioName, prompt: string): FakeScenario {
  switch (name) {
    case 'echo':
      return createEchoScenario(prompt)
    case 'plan-and-execute':
      return createPlanAndExecuteScenario()
    case 'tool-use':
      return createToolUseScenario()
    case 'error':
      return createErrorScenario()
  }
}

// ─── FakeAgent ────────────────────────────────────────────────

export class FakeAgent extends BaseAgent {
  readonly type: AgentProviderType = 'fake'
  private readonly scenarioName: ScenarioName
  private readonly customMessages: readonly AgentMessage[] | undefined
  private readonly delayMs: number

  constructor(config: AgentProviderConfig) {
    super()
    const pc = config.providerConfig as Record<string, unknown> | undefined
    this.scenarioName = (pc?.scenario as ScenarioName) || 'echo'
    this.customMessages = pc?.messages as readonly AgentMessage[] | undefined
    this.delayMs = (pc?.delayMs as number) || 0
  }

  async *stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage> {
    this.abortController = options?.abortController ?? new AbortController()
    const session = this.initSession(options?.sessionId)

    yield {
      id: 'fake-session',
      type: 'session',
      sessionId: session.id,
      timestamp: Date.now(),
    }

    const messages = this.customMessages ?? resolveScenario(this.scenarioName, prompt).messages

    for (const message of messages) {
      if (this.abortController?.signal.aborted) break

      if (this.delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, this.delayMs)
          this.abortController?.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
        if (this.abortController?.signal.aborted) break
      } else {
        // Yield microtask to allow abort signal to propagate
        await Promise.resolve()
        if (this.abortController?.signal.aborted) break
      }

      yield message
    }

    this.updateSessionStatus('completed')
  }
}

// ─── FakeProvider ─────────────────────────────────────────────

export class FakeProvider implements IAgentProvider {
  readonly type = 'fake'
  readonly name = 'Fake (Testing)'
  state: ProviderState = 'ready'

  createAgent(config: AgentProviderConfig): FakeAgent {
    return new FakeAgent(config)
  }

  validateConfig(_config: AgentProviderConfig): boolean {
    return true
  }

  getDefaultModel(): string {
    return 'fake-model'
  }

  getSupportedModels(): string[] {
    return ['fake-model']
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async init(): Promise<void> {
    this.state = 'ready'
  }

  async stop(): Promise<void> {
    this.state = 'stopped'
  }

  async shutdown(): Promise<void> {
    this.state = 'stopped'
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: false,
      supportsSystemPrompt: true,
      supportsSession: true,
    }
  }
}

// ─── Plugin Definition ────────────────────────────────────────

export function createFakeProvider(): FakeProvider {
  return new FakeProvider()
}

export const fakePlugin: AgentPlugin = {
  metadata: {
    type: 'fake',
    runtime: 'agent',
    name: 'Fake (Testing)',
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: false,
      supportsSystemPrompt: true,
      supportsSession: true,
      supportsPlanning: true,
      supportsParallelToolCalls: false,
    },
    defaultModel: 'fake-model',
  },
  factory: createFakeProvider,
}
