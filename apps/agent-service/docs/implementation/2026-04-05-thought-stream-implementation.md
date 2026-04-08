# Thought Stream 实时推理过程展示 - 实施记录

**日期**: 2026-04-05  
**状态**: ✅ 已完成  
**投入时间**: ~2 小时

---

## 背景

基于 [Arclay 改进路线图](../../../../docs/research/2026-04-04-arclay-improvement-roadmap.md) 的调研，发现 Claude SDK 的 thinking 输出在 `claude.ts:2615` 被主动屏蔽（`continue` 跳过）。前端已有完整的 `ThinkingSection` 组件，只需打通数据流即可启用推理过程展示。

## 实施内容

### 1. 类型定义 - `shared-types/src/agent.ts`

添加 `'thinking'` 到 `AgentMessageType`：

```typescript
export type AgentMessageType =
  | 'session'
  | 'text'
  | 'thinking'     // 新增：思考/推理过程
  | 'tool_use'
  | 'tool_result'
  // ...
```

### 2. 后端捕获 - `src-api/src/core/agent/providers/claude.ts:2615`

**修改前**（屏蔽 thinking）：
```typescript
if ('type' in block && block.type === 'thinking') {
  continue;  // 跳过，不发送给前端
}
```

**修改后**（捕获并发送）：
```typescript
if ('type' in block && block.type === 'thinking') {
  const thinkingText = this.sanitizeText((block as { thinking?: string }).thinking || '');
  if (thinkingText) {
    console.log(`[Claude ${sessionId}] Thinking: ${thinkingText.slice(0, 80)}...`);
    yield {
      id: this.generateMessageId(),
      type: 'thinking' as AgentMessageType,
      role: 'assistant',
      content: thinkingText,
      timestamp: Date.now(),
    };
  }
  continue;
}
```

### 3. 消息分类 - `src/shared/lib/task-message-turns.ts:144`

将 `thinking` 消息归入 `thinkingMessages` 数组：

```typescript
} else if (msg.type === 'clarification_request') {
  currentTurn.interactionMessages.push(msg)
  currentTurn.pendingQuestion = msg.clarification || msg.question || null
  lastAssistantTextWasContinuous = false
} else if (msg.type === 'thinking') {
  currentTurn.thinkingMessages.push(msg)  // 新增
  lastAssistantTextWasContinuous = false
} else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
  currentTurn.thinkingMessages.push(msg)
```

### 4. UI 渲染 - `src/components/task-detail/TaskMessageList.tsx:1725`

在 `ThinkingMessageItem` 组件中添加 `thinking` 类型处理：

```typescript
function ThinkingMessageItem({ message }: { message: AgentMessage }) {
  if (message.type === 'thinking') {
    return (
      <div className="flex items-start gap-2 py-1">
        <div className="flex-shrink-0 size-5 rounded bg-blue-500/10 flex items-center justify-center mt-0.5">
          <Brain className="size-3 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      </div>
    )
  }
  
  // ... 其他类型处理
}
```

---

## 验证结果

### 类型检查
```bash
pnpm typecheck
# ✅ PASS package=src script=typecheck
# ✅ PASS package=src-api script=typecheck
# ✅ PASS package=shared-types script=typecheck
```

### 构建验证
```bash
pnpm build
# ✅ src build: ✓ built in 3.51s
# ✅ src-api build: Done
```

### 改动文件
```
shared-types/src/agent.ts                      |   1 +
src-api/src/core/agent/providers/claude.ts     |  13 ++-
src/shared/lib/task-message-turns.ts           |   3 +
src/components/task-detail/TaskMessageList.tsx |  15 +++
```

---

## 用户体验提升

**修改前**：
- 用户只能看到工具调用和最终结果
- 无法了解 Agent 的推理过程
- 黑盒执行，信任感较低

**修改后**：
- 用户可以看到 Agent 的思考过程（thinking block）
- 推理过程在 `ThinkingSection` 中展示，可折叠
- 增强透明度和可控性
- 与 Accomplish 的 ThoughtEvent 功能对齐

---

## 后续优化建议

1. **结构化展示**：将 thinking 内容解析为 observation/reasoning/decision/action 四个维度（参考 Accomplish）
2. **语法高亮**：对 thinking 中的代码片段进行语法高亮
3. **搜索过滤**：支持在 thinking 内容中搜索关键词
4. **导出功能**：支持导出完整的推理过程用于分析

---

## 相关文档

- [Arclay 改进路线图](../../../../docs/research/2026-04-04-arclay-improvement-roadmap.md)
- [Accomplish 调研报告](../research/2026-04-04-accomplish-research.md)
- [实施计划](/Users/chanyun/.claude/plans/piped-knitting-reddy.md)
