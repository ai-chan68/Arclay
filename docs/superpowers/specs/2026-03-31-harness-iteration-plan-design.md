# Arclay Harness 迭代优化设计

**日期：** 2026-03-31
**分支：** fix/agent-harness-fixes
**参考：** `.claude/rules/harness-engineering.md`

---

## 背景

当前项目的 harness 工程实践基线约为 **7.0 / 10**。

已经完成的改进：
- Claude 执行侧 `maxTurns` 固定为 `200`，移除了正则复杂度检测
- 默认 system prompt 已精简为业务约束
- `ToolResult` 已引入 `status` / `summary` / `artifacts`
- `bash` 工具已开始使用结构化错误 contract
- `metrics` 已以 JSONL 方式落盘

当前仍然存在的关键缺口：
- 结构化 observation 只存在于工具返回类型，尚未端到端打通到运行时消息和消费链路
- conversation history budgeting 仍使用 `length / 4` 和 `break` 式截断
- permission / write scope / sandbox / MCP bypass 规则散落在 provider 中
- metrics 仍不足以稳定支撑 `pass@1/pass@3/retries/cost` 分析

---

## 目标

用 4 个连续、可独立回滚的迭代，把当前 harness 从“方向正确但尚未成体系”推进到“具备更强自主恢复能力、更稳的长任务表现、更清晰的边界定义，以及可持续 benchmark 能力”。

优先顺序为：

1. `Structured Tool Result Pipeline`
2. `Conversation Budgeting Fixes`
3. `Trust Boundary Policy Layer`
4. `Metrics Enrichment`

---

## 设计原则

### 1. 先增强 agent 的自恢复能力，再补治理与度量

最优先处理 observation pipeline，因为 agent 是否能稳定恢复，取决于它是否能拿到结构化、可消费的工具反馈，而不是日志字符串。

### 2. 每一轮只解决一个主问题

每轮范围必须收紧，避免把多项重构捆绑成一次大手术。每个迭代都要满足：
- 目标单一
- 改动边界清楚
- 可单独回滚
- 可单独验证

### 3. 兼容式升级，避免一次性替换

对消息结构、metrics 字段、权限判断等基础设施改动，优先采用“双轨兼容”策略：
- 保留旧字段
- 引入新字段
- 新代码优先消费新字段
- 旧逻辑逐步退化为 fallback

### 4. 把复杂度从 provider 主逻辑中移走

`claude.ts` 只应承担 provider 适配和运行时胶水职责，不应继续内联 permission policy、恢复策略、metrics 语义判断等横切逻辑。

---

## Iteration 0：基线冻结

### 目标

在进入连续优化前，先把当前基线固定住，避免后续迭代没有统一参照物。

### 范围

- 记录当前 harness 工程实践评分
- 固定 4 个迭代的 scope 和顺序
- 固定每轮统一验收命令
- 固定当前 metrics 字段语义

### 产出

- 当前 design 文档
- 一份 implementation plan
- 每轮验收 checklist

### 验收

- 后续迭代能明确回答“本轮改什么、不改什么”
- 所有人对 `attempt`、`success`、`durationMs` 等字段的当前语义没有歧义

---

## Iteration 1：Structured Tool Result Pipeline

### 目标

把结构化 observation 从工具层真正贯通到运行时消息、执行流、turn detail 和 metrics，使 agent 不再主要依赖字符串解析来理解工具结果。

### 设计

新增结构化 `toolResult` payload，挂载到 `AgentMessage` 的 `tool_result` 消息上，包含：

```ts
{
  status: 'success' | 'warning' | 'error'
  summary?: string
  output?: string
  error?: string
  exitCode?: number
  artifacts?: string[]
}
```

兼容策略：
- 保留现有 `toolOutput?: string`
- provider 发出 `tool_result` 时同时带 `toolResult` 和 `toolOutput`
- execution summary / blocker detection / turn detail / metrics 优先消费 `toolResult`
- 字符串逻辑仅做 fallback

### 影响范围

- `shared-types/src/agent.ts`
- `src-api/src/core/agent/providers/claude.ts`
- `src-api/src/services/execution-stream-processing.ts`
- `src-api/src/services/turn-detail-builder.ts`
- `src-api/src/services/agent-service.ts`

### 风险控制

- 不改前端展示协议的既有字段
- 不在本轮引入 `next_actions`
- 不重写全部 tool_result 处理逻辑，只做兼容升级

### 价值

- 为 agent 自主恢复提供统一 observation substrate
- 为后续 budgeting、policy、metrics 提供稳定输入

---

## Iteration 2：Conversation Budgeting Fixes

### 目标

修正长上下文任务的历史保留策略，提升中文和混排场景下的上下文利用率与稳定性。

### 设计

本轮只做两个改动：

1. token 估算从单一 `length / 4` 升级为带 CJK 修正系数的启发式估算
2. 历史裁剪从“遇到超预算消息即 break”改为“跳过该条消息，继续尝试装入更小的旧消息”

保留策略：
- 最近 `minMessagesToKeep` 条仍然强制保留
- 不引入真实 tokenizer 依赖
- 不在本轮修改 prompt 拼接结构

### 影响范围

- `src-api/src/core/agent/providers/claude.ts`
- conversation history tests

### 风险控制

- 只做局部算法修正，不扩展到 prompt 构建的其他逻辑
- 不追求精确 token 计数，只追求更稳健的 budgeting 行为

### 价值

- 避免单条大消息挤掉大量高价值小消息
- 让长中文任务在现有 context budget 下更稳定

---

## Iteration 3：Trust Boundary Policy Layer

### 目标

把权限边界、写入范围、高风险操作和 bypass 规则从 provider 内部 helper 中抽离，形成单一的 policy evaluator。

### 设计

抽象统一 policy 层，输入：
- `toolName`
- `toolInput`
- `cwd / taskId / sessionDir`
- `sandboxConfig`
- `mcpConfig`
- `approval settings`

输出：

```ts
{
  decision: 'allow' | 'deny' | 'require_approval'
  reason: string
  riskLevel?: 'low' | 'medium' | 'high'
  blockedPath?: string
  metadata?: Record<string, unknown>
}
```

本轮要收口的判断：
- `Bash` 在 sandbox 模式下的 host bash 禁用
- 写入范围校验
- MCP tool bypass
- Skill bypass
- auto-allow tool alias 归一化

### 影响范围

- `src-api/src/core/agent/providers/claude.ts`
- 新增 `src-api/src/core/agent/policy/*`
- permission 相关测试

### 风险控制

- 本轮重点是“收口已有规则”，不是新增大量规则
- 不改变审批 API 形态
- 不修改前端审批交互

### 价值

- provider 主逻辑显著变薄
- trust boundary 可测试、可审计、可演化

---

## Iteration 4：Metrics Enrichment

### 目标

把现有 append-only JSONL metrics 从“存在”提升到“可稳定算 benchmark”。

### 设计

在现有记录上补充：
- provider duration / total cost / result subtype
- warning count / error count
- repair attempts
- 结构化 artifacts

并明确定义 `attempt` 语义：
- 推荐定义为“同一 task 在可见执行层的第几次完整尝试”
- 如需单独记录 runtime auto-repair，应使用独立字段而不是复用 `attempt`

新增一个离线汇总脚本，直接输出：
- `pass@1`
- `pass@3`
- `retries/task`
- `cost/successful task`

### 影响范围

- `src-api/src/services/agent-service.ts`
- execution summary / provider completion metadata 消费逻辑
- 新增 `scripts/` 下离线分析脚本

### 风险控制

- 不改 DB schema
- 不引入新服务
- 仍保持 append-only JSONL

### 价值

- 后续每次 harness 优化都能用数据比较，而不是靠主观体感

---

## 建议迭代顺序

### 推荐路径

```text
Iteration 0
  -> Iteration 1
  -> Iteration 2
  -> Iteration 3
  -> Iteration 4
```

### 时间预估

- Iteration 0：0.5 天
- Iteration 1：1.5 ~ 2 天
- Iteration 2：1 天
- Iteration 3：1.5 ~ 2 天
- Iteration 4：1 天

### 缩减方案

如果时间只够两轮，优先做：
- Iteration 1
- Iteration 2

如果时间够三轮，优先做：
- Iteration 1
- Iteration 2
- Iteration 3

---

## 统一验收标准

每轮完成后统一执行：

```bash
pnpm --filter shared-types typecheck
pnpm --filter src-api typecheck
pnpm --filter src-api test
```

对于每轮新增能力，还应增加：
- 对应单元测试
- 一条回归测试，覆盖历史行为兼容
- 一条失败路径测试，覆盖错误 contract 或策略边界

---

## 不在本轮设计范围内

- 前端 UI 改版
- MCP/Skills 产品形态调整
- 多 agent 协作框架重做
- 数据库存储结构调整
- 真正 tokenizer 接入

---

## 建议结论

当前最合理的推进路线是：

1. 先打通结构化 observation
2. 再修历史 budgeting
3. 然后收口 trust boundary
4. 最后补 benchmark 维度

这样能最大化早期收益，并且把高耦合风险压到最低。
