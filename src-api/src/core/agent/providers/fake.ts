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

function createGameProjectScenario(): FakeScenario {
  return {
    name: 'game-project',
    messages: [
      {
        id: 'fake-game-text-1',
        type: 'text',
        role: 'assistant',
        content: '我将创建一个 HAPPYBIRD 小游戏，包含以下文件：\n- index.html\n- game.js\n- style.css',
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-tool-1',
        type: 'tool_use',
        role: 'assistant',
        toolName: 'write_file',
        toolInput: {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HAPPYBIRD</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <canvas id="gameCanvas" width="400" height="600"></canvas>
  <div id="score">0</div>
  <script src="game.js"></script>
</body>
</html>`,
        },
        toolUseId: 'fake-game-tool-1',
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-result-1',
        type: 'tool_result',
        toolUseId: 'fake-game-tool-1',
        toolName: 'write_file',
        toolOutput: JSON.stringify({
          status: 'success',
          summary: 'File created: index.html',
          next_actions: [],
          artifacts: ['index.html'],
        }),
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-tool-2',
        type: 'tool_use',
        role: 'assistant',
        toolName: 'write_file',
        toolInput: {
          path: 'game.js',
          content: `const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');

let score = 0;
let bird = { x: 50, y: 300, velocity: 0 };
const gravity = 0.5;
const jump = -10;

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Update bird
  bird.velocity += gravity;
  bird.y += bird.velocity;

  // Draw bird
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(bird.x, bird.y, 30, 30);

  // Update score
  score++;
  scoreElement.textContent = Math.floor(score / 60);

  requestAnimationFrame(gameLoop);
}

canvas.addEventListener('click', () => {
  bird.velocity = jump;
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    bird.velocity = jump;
  }
});

gameLoop();`,
        },
        toolUseId: 'fake-game-tool-2',
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-result-2',
        type: 'tool_result',
        toolUseId: 'fake-game-tool-2',
        toolName: 'write_file',
        toolOutput: JSON.stringify({
          status: 'success',
          summary: 'File created: game.js',
          next_actions: [],
          artifacts: ['game.js'],
        }),
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-tool-3',
        type: 'tool_use',
        role: 'assistant',
        toolName: 'write_file',
        toolInput: {
          path: 'style.css',
          content: `body {
  margin: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(to bottom, #87CEEB, #E0F6FF);
  font-family: Arial, sans-serif;
}

#gameCanvas {
  border: 3px solid #333;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

#score {
  margin-top: 20px;
  font-size: 32px;
  font-weight: bold;
  color: #333;
}`,
        },
        toolUseId: 'fake-game-tool-3',
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-result-3',
        type: 'tool_result',
        toolUseId: 'fake-game-tool-3',
        toolName: 'write_file',
        toolOutput: JSON.stringify({
          status: 'success',
          summary: 'File created: style.css',
          next_actions: [],
          artifacts: ['style.css'],
        }),
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-text-2',
        type: 'text',
        role: 'assistant',
        content: '游戏创建完成！可以打开 index.html 运行。点击画布或按空格键让小鸟跳跃。',
        timestamp: Date.now(),
      },
      {
        id: 'fake-game-done',
        type: 'done',
        timestamp: Date.now(),
      },
    ],
  }
}

function createSimpleHTMLScenario(): FakeScenario {
  return {
    name: 'simple-html',
    messages: [
      {
        id: 'fake-html-text-1',
        type: 'text',
        role: 'assistant',
        content: '我将创建一个简单的 HTML 页面。',
        timestamp: Date.now(),
      },
      {
        id: 'fake-html-tool-1',
        type: 'tool_use',
        role: 'assistant',
        toolName: 'write_file',
        toolInput: {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>简单页面</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
    }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>欢迎</h1>
  <p>这是一个简单的 HTML 页面。</p>
</body>
</html>`,
        },
        toolUseId: 'fake-html-tool-1',
        timestamp: Date.now(),
      },
      {
        id: 'fake-html-result-1',
        type: 'tool_result',
        toolUseId: 'fake-html-tool-1',
        toolName: 'write_file',
        toolOutput: JSON.stringify({
          status: 'success',
          summary: 'File created: index.html',
          next_actions: [],
          artifacts: ['index.html'],
        }),
        timestamp: Date.now(),
      },
      {
        id: 'fake-html-text-2',
        type: 'text',
        role: 'assistant',
        content: 'HTML 页面创建完成！',
        timestamp: Date.now(),
      },
      {
        id: 'fake-html-done',
        type: 'done',
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

function detectScenarioFromPrompt(prompt: string): FakeScenario | null {
  const lowerPrompt = prompt.toLowerCase()

  // Game project detection
  if (lowerPrompt.includes('happybird') ||
      lowerPrompt.includes('小游戏') ||
      lowerPrompt.includes('game')) {
    return createGameProjectScenario()
  }

  // Simple HTML detection
  if (lowerPrompt.includes('html') &&
      (lowerPrompt.includes('页面') || lowerPrompt.includes('网页'))) {
    return createSimpleHTMLScenario()
  }

  return null
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

    // Priority: customMessages > detected scenario > configured scenario
    let messages: readonly AgentMessage[]
    if (this.customMessages) {
      messages = this.customMessages
    } else {
      const detectedScenario = detectScenarioFromPrompt(prompt)
      if (detectedScenario) {
        messages = detectedScenario.messages
      } else {
        messages = resolveScenario(this.scenarioName, prompt).messages
      }
    }

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
