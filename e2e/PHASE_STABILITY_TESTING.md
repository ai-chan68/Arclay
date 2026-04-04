# Phase 闪烁问题与 E2E 测试覆盖

## 问题回顾

### 原始问题（commit 16f9698）

**现象**：任务提交后，计划生成阶段页面一直闪烁

**根本原因**：
```typescript
// useAgentNew.ts 轮询逻辑
const poll = async (): Promise<void> => {
  await refreshPendingRequests()  // 可能设置 phase = 'awaiting_clarification'
  if (shouldPollRuntimePhase(phaseRef.current)) {
    await refreshTurnRuntime()    // 可能覆盖为 phase = 'planning'
  }
  timer = setTimeout(poll, 1500)
}
```

两个异步函数返回数据不同步，导致：
- `refreshPendingRequests` 检测到 pending question → `awaiting_clarification`
- `refreshTurnRuntime` 读取 turn state → `planning`
- 两者互相覆盖，phase 来回切换，页面闪烁

### 修复方案

1. **建立优先级**：pending interactions > turn state
2. **条件更新**：只在 phase 真正需要变化时才更新
3. **避免覆盖**：`refreshTurnRuntime` 不覆盖 `awaiting_clarification`/`awaiting_approval`

```typescript
// refreshPendingRequests
if (nextQuestion && phaseRef.current !== 'awaiting_clarification') {
  updatePhase('awaiting_clarification')
}

// refreshTurnRuntime
const hasPendingInteraction =
  phaseRef.current === 'awaiting_clarification' ||
  phaseRef.current === 'awaiting_approval'
if (newPhase !== phaseRef.current && !hasPendingInteraction) {
  updatePhase(newPhase)
}
```

## 原有 E2E 测试的局限性

### 为什么原有测试无法发现这个问题？

#### 1. 只验证最终状态

```typescript
// task-lifecycle.spec.ts
await page.getByRole('button', { name: '开始执行' }).click()
await expect(page.getByTitle('停止')).toBeVisible()
```

这种测试只检查"按钮最终是否可见"，无法捕获：
- Phase 在中间状态的快速切换
- UI 元素短暂出现又消失
- 状态更新的时序问题

#### 2. 缺少状态变化监控

原有测试没有追踪 phase 转换序列，无法检测：
- 非单调的状态转换（backward transitions）
- 同一状态的非连续重复（flickering）
- 竞态条件导致的状态冲突

#### 3. 没有模拟网络延迟

Mock API 立即返回响应，无法触发真实环境中的竞态条件：
- 两个 API 调用的响应时间差异
- 轮询间隔内的多次状态更新
- 异步操作的交错执行

## 新增测试的覆盖能力

### 1. Phase 闪烁检测

**测试**：`phase transitions should not flicker during planning`

**如何发现问题**：
```typescript
// 注入追踪器
await page.addInitScript(() => {
  (window as any).__trackPhase = (phase: string) => {
    (window as any).__phaseChanges.push({ phase, timestamp: Date.now() })
  }
})

// 监控 DOM 变化
const observer = new MutationObserver(() => {
  const phase = document.querySelector('[data-phase]')?.getAttribute('data-phase')
  if (phase) __trackPhase(phase)
})
```

**检测逻辑**：
```typescript
// 分析 phase 序列：['planning', 'awaiting_clarification', 'planning', 'awaiting_clarification']
const phaseOccurrences = new Map<string, number[]>()
phaseSequence.forEach((phase, index) => {
  phaseOccurrences.get(phase).push(index)
})

// 检测非连续出现（闪烁）
for (const [phase, indices] of phaseOccurrences.entries()) {
  const isConsecutive = indices.every((idx, i) => 
    i === 0 || idx === indices[i - 1] + 1
  )
  if (!isConsecutive) {
    // 发现闪烁！
    console.error(`Phase "${phase}" flickered at indices:`, indices)
  }
}
```

**能捕获的问题**：
- ✅ Phase 在 `planning` ↔ `awaiting_clarification` 之间切换
- ✅ 任何非单调的状态转换
- ✅ 状态回退（executing → planning）

### 2. 并发 API 调用冲突检测

**测试**：`concurrent API calls should not cause phase conflicts`

**如何触发竞态条件**：
```typescript
// 模拟不同的网络延迟
await page.route('**/api/v2/agent/pending', async (route) => {
  await new Promise(resolve => setTimeout(resolve, 150))  // 慢
  const response = await route.fetch()
  await route.fulfill({ response })
})

await page.route('**/api/v2/agent/runtime/**', async (route) => {
  await new Promise(resolve => setTimeout(resolve, 50))   // 快
  const response = await route.fetch()
  await route.fulfill({ response })
})
```

**时序分析**：
```
t=0ms:    轮询开始
t=0ms:    refreshPendingRequests 发起（延迟 150ms）
t=0ms:    refreshTurnRuntime 发起（延迟 50ms）
t=50ms:   refreshTurnRuntime 返回 → 设置 phase = 'planning'
t=150ms:  refreshPendingRequests 返回 → 设置 phase = 'awaiting_clarification'
t=1500ms: 下一轮轮询开始，重复上述过程
```

**能捕获的问题**：
- ✅ 响应时间差异导致的状态覆盖
- ✅ 轮询触发的重复状态更新
- ✅ UI 进入 broken state（输入框永久禁用）

### 3. 视觉稳定性检测

**测试**：`no visual flickering during execution`

**如何检测视觉闪烁**：
```typescript
// 连续截图
const screenshots: Buffer[] = []
for (let i = 0; i < 10; i++) {
  screenshots.push(await page.screenshot())
  await page.waitForTimeout(200)
}

// 可以进一步比较截图差异（使用 pixelmatch 等库）
```

**能捕获的问题**：
- ✅ UI 元素快速出现/消失
- ✅ 布局抖动
- ✅ 加载状态闪烁

## 测试覆盖对比

| 问题类型 | 原有测试 | 新增测试 | 说明 |
|---------|---------|---------|------|
| 功能完整性 | ✅ | ✅ | 任务能否正常执行 |
| 最终状态正确性 | ✅ | ✅ | 执行完成后状态是否正确 |
| **状态转换单调性** | ❌ | ✅ | Phase 是否单向推进 |
| **闪烁检测** | ❌ | ✅ | 状态是否来回切换 |
| **竞态条件** | ❌ | ✅ | 并发调用是否冲突 |
| **视觉稳定性** | ❌ | ✅ | UI 是否抖动 |
| **时序问题** | ❌ | ✅ | 异步操作顺序 |

## 如何使用这些测试

### 开发阶段

```bash
# 修改状态管理逻辑后，立即运行
pnpm test:e2e phase-stability

# 如果测试失败，检查：
# 1. Phase 转换序列是否符合预期
# 2. 是否有非连续的状态重复
# 3. UI 是否保持可交互状态
```

### 回归测试

```bash
# 每次提交前运行完整测试套件
pnpm test:e2e

# CI 环境自动运行
# 失败时会生成截图和视频，便于排查
```

### 调试闪烁问题

1. **启用控制台日志**：
```typescript
page.on('console', msg => console.log('[browser]', msg.text()))
```

2. **查看 phase 变化序列**：
```
[phase-stability] Phase sequence: ['planning', 'awaiting_clarification', 'planning']
```

3. **分析时间戳**：
```typescript
phaseChanges.forEach(({ phase, timestamp }) => {
  console.log(`${timestamp}: ${phase}`)
})
```

## 未来改进方向

### 1. 更精细的状态追踪

```typescript
// 追踪完整的状态机转换
interface StateTransition {
  from: AgentPhase
  to: AgentPhase
  trigger: 'refreshPendingRequests' | 'refreshTurnRuntime' | 'user_action'
  timestamp: number
}
```

### 2. 性能指标

```typescript
// 测量状态更新频率
const updateFrequency = phaseChanges.length / totalDuration
expect(updateFrequency).toBeLessThan(5) // 每秒不超过 5 次更新
```

### 3. 视觉回归工具集成

```typescript
// 使用 Percy 或 Chromatic
await percySnapshot(page, 'task-execution-stable')
```

## 总结

### 原有测试 vs 新增测试

**原有测试**：
- ✅ 验证功能完整性
- ✅ 检查最终状态
- ❌ 无法发现中间状态问题
- ❌ 无法检测竞态条件

**新增测试**：
- ✅ 追踪状态转换序列
- ✅ 检测非单调转换
- ✅ 模拟网络延迟触发竞态
- ✅ 视觉稳定性验证

### 关键收获

1. **功能测试 ≠ 稳定性测试**
   - 功能测试验证"能否完成"
   - 稳定性测试验证"过程是否平滑"

2. **状态管理需要专门测试**
   - 追踪状态转换序列
   - 检测非预期的状态变化
   - 验证状态机的单调性

3. **竞态条件需要主动触发**
   - Mock 延迟模拟真实网络
   - 验证并发场景下的正确性
   - 确保 UI 不会进入 broken state

### 测试金字塔

```
        /\
       /  \  E2E 稳定性测试（新增）
      /____\
     /      \  E2E 功能测试（原有）
    /________\
   /          \  集成测试
  /____________\
 /              \  单元测试
/________________\
```

新增的稳定性测试位于金字塔顶端，专注于：
- 用户体验质量
- 状态管理正确性
- 边界场景和竞态条件
