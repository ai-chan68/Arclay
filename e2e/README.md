# EasyWork E2E 测试

## 测试套件概览

### Mock E2E 测试 (`tests/`)

使用 mock API server，快速验证前端交互逻辑。

#### 基础功能测试

- **app-startup.spec.ts** - 应用启动流程
- **task-lifecycle.spec.ts** - 任务生命周期（创建、执行、中止）
- **multi-turn.spec.ts** - 多轮对话执行
- **error-scenarios.spec.ts** - 错误场景处理
- **library-page.spec.ts** - 任务库页面

#### 稳定性测试

- **phase-stability.spec.ts** - Phase 状态稳定性测试（新增）
  - 检测 phase 闪烁问题
  - 验证并发 API 调用不会导致状态冲突
  - 视觉稳定性检测

### Integration E2E 测试 (`tests-integration/`)

使用真实 API + Fake Provider，验证完整技术栈。

- **app-startup.spec.ts** - 真实 API 启动和健康检查

## Phase 稳定性测试详解

### 背景

在 commit `16f9698` 中修复了一个 phase 闪烁问题：

**问题根因**：`refreshPendingRequests` 和 `refreshTurnRuntime` 并发执行时，返回数据不同步，导致 phase 在 `planning` ↔ `awaiting_clarification` 之间快速切换。

**修复方案**：
1. 建立优先级：pending interactions > turn state
2. 只在 phase 真正需要变化时才更新
3. 避免覆盖 awaiting_clarification/awaiting_approval 状态

### 测试用例

#### 1. Phase 闪烁检测

```typescript
test('phase transitions should not flicker during planning')
```

**验证内容**：
- 监控 DOM 变化，记录 phase 转换序列
- 检测同一 phase 是否非连续出现（闪烁特征）
- 确保 phase 转换是单调的

**如何工作**：
- 注入 `__trackPhase` 函数到页面
- 使用 MutationObserver 监听 `[data-phase]` 属性变化
- 分析 phase 序列，检测非连续重复

#### 2. 并发 API 调用冲突检测

```typescript
test('concurrent API calls should not cause phase conflicts')
```

**验证内容**：
- 模拟网络延迟（pending: 150ms, runtime: 50ms）
- 触发竞态条件
- 验证 UI 保持稳定状态

**如何工作**：
- 拦截 `/api/v2/agent/pending` 和 `/api/v2/agent/runtime/**`
- 添加不同延迟模拟真实网络环境
- 验证轮询触发多次调用后 UI 仍可用

#### 3. 视觉稳定性检测

```typescript
test('no visual flickering during execution')
```

**验证内容**：
- 连续截图检测视觉变化
- 确保执行过程中无异常闪烁

**如何工作**：
- 每 200ms 截图一次，共 10 次
- 验证截图数量正确
- 确保页面保持可交互状态

## 运行测试

```bash
# 运行所有 Mock E2E 测试
pnpm test:e2e

# 只运行 phase 稳定性测试
pnpm test:e2e phase-stability

# 运行 Integration E2E 测试
pnpm test:e2e:integration

# 调试模式
pnpm test:e2e --debug

# 生成 HTML 报告
pnpm test:e2e --reporter=html
```

## 测试架构

### Mock API Server (`mock-api-server.mjs`)

轻量级 HTTP 服务器，模拟所有 API 端点：

- `/api/health` - 健康检查
- `/api/settings` - 设置管理
- `/api/v2/agent/plan` - 计划生成（SSE）
- `/api/v2/agent/execute` - 任务执行（SSE）
- `/api/v2/agent/pending` - 待处理请求
- `/api/v2/agent/runtime/:sessionId` - 运行时状态

**特殊触发词**：
- `trigger-error` - 模拟服务器错误
- `multi-turn` - 模拟多轮对话

### Integration API Server (`integration-api-server.mjs`)

启动真实 API 服务器的引导脚本：

- 创建隔离的临时 `EASYWORK_HOME`
- 配置 Fake Provider（无需真实 API key）
- 启动真实 Hono API 服务器
- 测试完整链路：Frontend → Hono → AgentService → FakeAgent

## 最佳实践

### 何时添加新测试

1. **功能测试** - 新增用户可见功能时
2. **回归测试** - 修复 bug 后，防止再次出现
3. **稳定性测试** - 发现状态管理或竞态条件问题时

### 测试命名规范

```typescript
test('should [expected behavior] when [condition]', async ({ page }) => {
  // 测试逻辑
})
```

### 断言策略

- 使用 `toBeVisible()` 而非 `toBeTruthy()`
- 设置合理的 timeout（默认 30s）
- 优先检查最终状态，而非中间状态

### 调试技巧

```typescript
// 截图
await page.screenshot({ path: 'debug.png' })

// 控制台日志
page.on('console', msg => console.log(msg.text()))

// 暂停执行
await page.pause()
```

## CI/CD 集成

测试在 CI 环境中自动运行：

```yaml
- name: Run E2E tests
  run: pnpm test:e2e
  env:
    CI: true
```

CI 模式下：
- `reuseExistingServer: false` - 每次启动新服务器
- 自动生成测试报告和截图
- 失败时保留视频录像

## 故障排查

### 端口占用

```bash
# 清理占用的端口
lsof -ti:1420,2026 | xargs kill -9
```

### 测试超时

- 检查 `playwright.config.ts` 中的 `timeout` 设置
- 增加 `waitForTimeout` 时长
- 使用 `{ timeout: 60000 }` 覆盖默认值

### Mock 数据不匹配

- 检查 `mock-api-server.mjs` 中的响应格式
- 确保与真实 API 响应结构一致
- 更新 `shared-types` 中的类型定义

## 复杂任务测试

### 当前局限性

Mock E2E 测试**无法验证**复杂任务的实际结果，例如：
- ❌ "写个 HAPPYBIRD 小游戏" - 无法验证游戏文件是否生成
- ❌ "创建 TODO 应用" - 无法检查代码是否可运行
- ❌ 多文件项目 - 无法验证项目完整性

**原因**：Mock API 返回预定义响应，不执行真实的代码生成。

### 解决方案

详见 [COMPLEX_TASKS_TESTING.md](./COMPLEX_TASKS_TESTING.md)，推荐方案：

1. **Integration E2E + FakeAgent** - 增强 FakeAgent 支持预定义任务场景
2. **Real LLM E2E** - 使用真实 Claude API（发布前运行）
3. **混合策略** - Mock（快速） + Integration（中速） + Real LLM（慢速）

```bash
# 运行 Integration 测试（需要先实现 FakeAgent 场景）
pnpm test:e2e:integration

# 运行 Real LLM 测试（需要 API key）
pnpm test:e2e:real
```

## 未来改进

- [ ] 增强 FakeAgent 支持复杂任务场景
- [ ] 添加 Integration E2E 测试（文件创建验证）
- [ ] 添加 Real LLM E2E 测试（发布前运行）
- [ ] 添加性能测试（Lighthouse CI）
- [ ] 集成视觉回归工具（Percy/Chromatic）
- [ ] 增加可访问性测试（axe-core）
- [ ] 添加更多边界场景测试
- [ ] 实现测试数据工厂模式
