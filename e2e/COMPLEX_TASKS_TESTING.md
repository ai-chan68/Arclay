# 复杂任务 E2E 测试指南

## 问题：当前测试的局限性

### 示例任务："写个 HAPPYBIRD 小游戏"

**当前 Mock E2E 测试无法验证**：
- ❌ 是否真的生成了游戏文件（HTML/JS/CSS）
- ❌ 生成的代码是否可运行
- ❌ 游戏逻辑是否正确
- ❌ 多文件项目的完整性

**只能验证**：
- ✅ UI 能否接受输入
- ✅ 任务能否创建
- ✅ 执行按钮能否点击
- ✅ 状态转换是否正常

### 根本原因

```javascript
// mock-api-server.mjs - 所有任务返回相同的通用响应
writeSse(res, [
  {
    delayMs: 10,
    message: {
      type: 'text',
      content: '正在执行模拟任务，请稍候...'
    }
  }
], 15000)
```

Mock API 不执行真实的代码生成，无法验证任务结果。

## 解决方案

### 方案 1：Integration E2E + Fake Provider（推荐）

使用真实 API + Fake Provider，验证完整流程但不依赖真实 LLM。

#### 架构

```
Frontend → Real Hono API → AgentService → FakeAgent → File System
```

#### FakeAgent 能力

需要增强 FakeAgent 支持预定义的任务场景：

```typescript
// src-api/src/core/agent/providers/fake.ts
export class FakeAgent implements IAgent {
  async *run(prompt: string): AsyncGenerator<AgentMessage> {
    // 检测任务类型
    if (prompt.includes('HAPPYBIRD') || prompt.includes('小游戏')) {
      yield* this.generateGameProject()
    } else if (prompt.includes('HTML 页面')) {
      yield* this.generateSimpleHTML()
    } else {
      yield* this.generateGenericResponse()
    }
  }

  private async *generateGameProject(): AsyncGenerator<AgentMessage> {
    // 1. 规划阶段
    yield {
      type: 'text',
      content: '我将创建一个 HAPPYBIRD 小游戏，包含以下文件：\n- index.html\n- game.js\n- style.css'
    }

    // 2. 创建文件
    yield {
      type: 'tool_use',
      toolName: 'write_file',
      toolInput: {
        path: 'index.html',
        content: '<html>...</html>'
      }
    }

    yield {
      type: 'tool_result',
      toolOutput: 'File created: index.html'
    }

    // 3. 完成
    yield {
      type: 'text',
      content: '游戏创建完成！可以打开 index.html 运行。'
    }

    yield { type: 'done' }
  }
}
```

#### 测试用例

```typescript
// e2e/tests-integration/complex-tasks.spec.ts
test('HAPPYBIRD game creation produces playable files', async ({ page }) => {
  const workspaceDir = await setupTestWorkspace()

  await page.goto('/')
  await page.getByPlaceholder('描述你的任务').fill('写个 HAPPYBIRD 小游戏')
  await page.getByTitle('发送').click()
  await page.getByRole('button', { name: '开始执行' }).click()

  // 等待执行完成
  await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

  // 验证文件创建
  expect(fs.existsSync(path.join(workspaceDir, 'index.html'))).toBeTruthy()
  expect(fs.existsSync(path.join(workspaceDir, 'game.js'))).toBeTruthy()
  expect(fs.existsSync(path.join(workspaceDir, 'style.css'))).toBeTruthy()

  // 验证文件内容
  const htmlContent = fs.readFileSync(path.join(workspaceDir, 'index.html'), 'utf-8')
  expect(htmlContent).toContain('<canvas')
  expect(htmlContent).toContain('game.js')

  // 可选：启动本地服务器验证游戏可运行
  const server = await startLocalServer(workspaceDir)
  await page.goto(`http://localhost:${server.port}`)
  await expect(page.locator('canvas')).toBeVisible()
  await server.close()
})
```

#### 优点
- ✅ 测试完整技术栈（Frontend → API → Agent → File System）
- ✅ 不依赖真实 LLM（无 API 成本，速度快）
- ✅ 可预测的结果（便于断言）
- ✅ 可在 CI 环境运行

#### 缺点
- ⚠️ 需要为每种任务类型编写 FakeAgent 场景
- ⚠️ 无法测试真实 LLM 的代码生成质量

### 方案 2：真实 LLM E2E（昂贵但全面）

使用真实 Claude API 执行任务，验证端到端的真实场景。

#### 配置

```typescript
// e2e/playwright.real-llm.config.ts
export default defineConfig({
  testDir: './tests-real-llm',
  timeout: 300_000, // 5 分钟（真实 LLM 较慢）
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:1422',
  },
  webServer: [
    {
      command: 'pnpm dev:api', // 使用真实 API 配置
      port: 2028,
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        LLM_PROVIDER: 'claude',
      },
    },
    {
      command: 'pnpm dev:web',
      port: 1422,
    },
  ],
})
```

#### 测试用例

```typescript
// e2e/tests-real-llm/game-creation.spec.ts
test('real LLM creates playable HAPPYBIRD game', async ({ page }) => {
  test.setTimeout(300_000) // 5 分钟

  const workspaceDir = await setupTestWorkspace()

  await page.goto('/')
  await page.getByPlaceholder('描述你的任务').fill('写个 HAPPYBIRD 小游戏')
  await page.getByTitle('发送').click()
  await page.getByRole('button', { name: '开始执行' }).click()

  // 等待真实 LLM 完成（可能需要几分钟）
  await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 300_000 })

  // 验证生成的文件
  const files = fs.readdirSync(workspaceDir)
  expect(files.length).toBeGreaterThan(0)

  // 验证游戏可运行
  const server = await startLocalServer(workspaceDir)
  await page.goto(`http://localhost:${server.port}`)
  
  // 基本交互测试
  await page.click('canvas') // 点击开始游戏
  await page.keyboard.press('Space') // 模拟跳跃
  
  // 验证游戏逻辑
  const score = await page.locator('#score').textContent()
  expect(parseInt(score)).toBeGreaterThanOrEqual(0)

  await server.close()
})
```

#### 优点
- ✅ 测试真实的代码生成能力
- ✅ 发现真实场景中的问题
- ✅ 验证 LLM 输出质量

#### 缺点
- ❌ 成本高（每次测试消耗 API tokens）
- ❌ 速度慢（几分钟/测试）
- ❌ 结果不可预测（LLM 输出可能变化）
- ❌ 不适合频繁运行（CI 成本高）

### 方案 3：混合策略（最佳实践）

结合 Mock、Integration 和 Real LLM 测试：

```
┌─────────────────────────────────────────────────────────┐
│ Mock E2E (快速，每次提交运行)                            │
│ - UI 交互流程                                            │
│ - 状态管理                                               │
│ - 错误处理                                               │
│ - Phase 稳定性                                           │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Integration E2E + FakeAgent (中速，每天运行)            │
│ - 文件创建验证                                           │
│ - 工具调用正确性                                         │
│ - 多文件项目完整性                                       │
│ - 预定义场景覆盖                                         │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Real LLM E2E (慢速，发布前运行)                          │
│ - 真实代码生成质量                                       │
│ - 复杂任务端到端验证                                     │
│ - 回归测试关键场景                                       │
└─────────────────────────────────────────────────────────┘
```

#### 运行策略

```bash
# 开发时：只运行 Mock 测试
pnpm test:e2e

# 提交前：运行 Mock + Integration
pnpm test:e2e && pnpm test:e2e:integration

# 发布前：运行全部测试
pnpm test:e2e:all  # Mock + Integration + Real LLM
```

## 实施步骤

### Step 1: 增强 FakeAgent

```typescript
// src-api/src/core/agent/providers/fake.ts
interface TaskScenario {
  pattern: RegExp
  generator: () => AsyncGenerator<AgentMessage>
}

const TASK_SCENARIOS: TaskScenario[] = [
  {
    pattern: /HAPPYBIRD|小游戏|game/i,
    generator: generateGameProject,
  },
  {
    pattern: /HTML.*页面|网页/i,
    generator: generateSimpleHTML,
  },
  {
    pattern: /TODO.*应用|待办/i,
    generator: generateTodoApp,
  },
]

export class FakeAgent implements IAgent {
  async *run(prompt: string): AsyncGenerator<AgentMessage> {
    const scenario = TASK_SCENARIOS.find(s => s.pattern.test(prompt))
    if (scenario) {
      yield* scenario.generator()
    } else {
      yield* generateGenericResponse()
    }
  }
}
```

### Step 2: 添加 Integration 测试

```bash
# 创建测试文件
touch e2e/tests-integration/complex-tasks.spec.ts

# 更新 package.json
{
  "scripts": {
    "test:e2e:integration": "playwright test --config e2e/playwright.integration.config.ts"
  }
}
```

### Step 3: 添加 Real LLM 测试（可选）

```bash
# 创建配置
touch e2e/playwright.real-llm.config.ts

# 创建测试目录
mkdir e2e/tests-real-llm

# 更新 package.json
{
  "scripts": {
    "test:e2e:real": "playwright test --config e2e/playwright.real-llm.config.ts"
  }
}
```

### Step 4: CI 配置

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  mock-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: pnpm install
      - run: pnpm test:e2e

  integration-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: pnpm install
      - run: pnpm test:e2e:integration

  real-llm-e2e:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'  # 只在 main 分支运行
    steps:
      - uses: actions/checkout@v3
      - run: pnpm install
      - run: pnpm test:e2e:real
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## 测试覆盖矩阵

| 任务类型 | Mock E2E | Integration E2E | Real LLM E2E |
|---------|----------|-----------------|--------------|
| UI 交互 | ✅ | ✅ | ✅ |
| 状态管理 | ✅ | ✅ | ✅ |
| 错误处理 | ✅ | ✅ | ✅ |
| 文件创建 | ❌ | ✅ | ✅ |
| 代码质量 | ❌ | ⚠️ (预定义) | ✅ |
| 复杂任务 | ❌ | ⚠️ (有限场景) | ✅ |
| 运行速度 | 快 (30s) | 中 (2min) | 慢 (5-10min) |
| CI 成本 | 低 | 低 | 高 |

## 总结

### 当前状态
- ✅ Mock E2E 覆盖 UI 和状态管理
- ❌ 无法验证"写个 HAPPYBIRD 小游戏"这类复杂任务

### 推荐方案
1. **短期**：增强 FakeAgent，添加 Integration E2E 测试
2. **中期**：建立混合测试策略（Mock + Integration + Real LLM）
3. **长期**：自动化测试覆盖所有关键任务场景

### 下一步
1. 实现 FakeAgent 的任务场景支持
2. 添加 `complex-tasks.spec.ts` 测试文件
3. 配置 CI 运行 Integration 测试
4. 根据需要添加 Real LLM 测试
