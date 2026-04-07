# Arclay Agent Harness 重构设计

**日期：** 2026-03-31
**分支：** fix/agent-harness-fixes
**参考：** `.claude/rules/harness-engineering.md`

---

## 背景与目标

本次重构依据团队 harness 工程实践文档，对 Arclay 后端 Agent 执行层进行系统性对齐。核心认知：

> **Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions**
> 工程师的工作是提供好的工作环境，不要试图用代码替模型做判断。

**目标：** 让 Agent 在任何错误路径下都能自主恢复，消除 harness 替模型做决策的反模式。

---

## 一、Action Space — ITool 接口修复 & 去除复杂度检测

### 现状

`ITool` 接口定义（`src/core/tools/interface.ts`）：
```typescript
execute(params: Record<string, unknown>): Promise<ToolResult>
```

而 `BashTool` 等实现实际签名是：
```typescript
execute(params, context?: ToolContext): Promise<ToolResult>
```

接口与实现脱节，`context`（含 `signal`/`workDir`）无法类型安全传递。

同时，`detectTaskComplexity()`（`providers/claude.ts`）通过正则匹配 prompt 关键词来决定 `maxTurns`（15/50/100/200）——这是 harness 替模型做判断的典型反模式：正则极不可靠（\"fix my schedule\" 会被误判为 medium 任务），且 maxTurns 是安全上限而非目标值，Claude 靠 `stop_reason` 自行终止。

### 方案

1. **修复 `ITool` 接口**，将 `context` 纳入标准签名：
```typescript
execute(params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>
```

2. **删除 `detectTaskComplexity()`**，`maxTurns` 固定为 `200`（安全上限）。Claude Agent SDK 的 `stop_reason` 机制确保任务完成后自然终止，不会真正跑满 200 轮。

### 为什么这么做

- 接口一致性是工具注册/调用链类型安全的基础
- 去除复杂度检测后，代码量减少，也消除了一类潜在的任务被过早截断的 bug

---

## 二、Observation 结构 & Error Recovery Contract

### 现状

`ToolResult`（`shared-types`）当前结构：
```typescript
{ success: boolean, output?: string, error?: string, exitCode?: number }
```

问题：
- `success: boolean` 无法区分 warning（继续）和 error（需恢复），Agent 只能猜
- `error` 是自由文本，无 root cause、无重试指引、无 stop condition
- 无 `summary`：Agent 必须全量解析 `output` 才能判断结果
- 无 `artifacts`：工具产出文件路径分散，无法被指标收集追踪

### 方案

扩展 `ToolResult`（`shared-types`，向后兼容，新字段全部可选）：
```typescript
interface ToolResult {
  success: boolean           // 保留，向后兼容
  status?: 'success' | 'warning' | 'error'  // 细粒度状态
  output?: string
  error?: string             // 改为三件套格式
  exitCode?: number
  summary?: string           // 一句话结果，Agent 快速决策用
  artifacts?: string[]       // 产出文件路径，供指标收集
}
```

**Error 三件套格式约定：**
```
[root] <根因描述> | [retry] <具体重试指令> | [stop] <终止条件>
```

**BashTool 三种场景改造：**

| 场景 | 旧 error | 新 error |
|------|----------|----------|
| 超时 | `Command timed out after 60000ms` | `[root] timed out after 60000ms \| [retry] reduce scope or increase timeout \| [stop] after 3 retries` |
| 非零退出 | `undefined`（靠 success:false 隐含） | `[root] exit code 1: <stderr first line> \| [retry] check command syntax \| [stop] if same error repeats` |
| 命令缺失 | `Command failed: spawn git ENOENT` | `[root] command not found: git \| [retry] install via brew/apt \| [stop] immediately` |

**status 语义：**
- `warning`：有 stderr 但退出码 0（不阻断流程）
- `error`：退出码非 0 或超时
- `success`：退出码 0 且无 stderr

### 为什么这么做

结构化的 error 让 Agent 无需解析自由文本即可决策恢复路径，从而实现自主错误恢复，而不是静默失败或无限重试。

---

## 三、Context Budget — System Prompt 精简

### 现状

`getDefaultSystemPrompt()`（`src/core/agent/system-prompt.ts`）约 150 行，其中：
- `## Available Tools` 章节：逐一列出 6 个工具的参数说明（~60 行）
- `## CRITICAL: YOU MUST USE TOOL CALLS` 警告块（~10 行）
- `## File Type Handling` 章节（~20 行）
- 业务规则（语言、workDir、append 警告）（~25 行）

**问题：** 工具参数定义已在各 `ToolDefinition.parameters` schema 里，Claude 原生读取——system-prompt 重复定义是噪声。`YOU MUST USE TOOL CALLS` 是早期 Claude workaround，现代 Claude 不需要。system-prompt 在每轮 turn 都重复计费，越长成本越高。

### 方案

**保留（业务特有，schema 无法表达）：**
- 语言指令：默认简体中文
- `workDir` 强制规则：所有文件必须写入 `${workDir}/`
- `append` 工具使用告警：大批量输出必须逐条写，防截断
- 文件类型特殊处理：`.xlsx` 用 Python/pandas，不用 read 工具

**删除（Claude Agent SDK / ToolDefinition schema 已覆盖）：**
- `## Available Tools` 整个章节（~60 行）
- `## CRITICAL: YOU MUST USE TOOL CALLS` 章节（~10 行）
- 工具参数的重复说明

**结果：** ~150 行 → ~25 行，每轮节省 ~500 token。

### 为什么这么做

harness-engineering.md 原则：系统 prompt 保持最小不变，知识注入通过 tool_result 动态加载。精简 system-prompt 直接降低每轮成本，同时减少对 Claude 注意力的干扰。

---

## 四、可观测性 — Metrics JSONL

### 现状

无任何 pass@1/pass@3 指标收集。任务成功率、重试次数、token 成本只能从 history 日志手动挖掘，无法量化 harness 质量改进。

### 方案

**写入时机：** 任务执行完成（`done` 类型消息触发）时，`AgentService` 追加一行到：
```
~/.arclay/metrics/YYYY-MM.jsonl
```

**每行结构：**
```jsonl
{"ts":"2026-03-31T10:00:00Z","taskId":"xxx","runId":"yyy","attempt":1,"success":true,"durationMs":12340,"model":"claude-sonnet-4-6","provider":"claude","artifacts":["path/to/file.ts"]}
```

**字段说明：**
- `attempt`：第几次尝试（1 = pass@1，≤3 = pass@3）
- `success`：任务是否成功完成
- `durationMs`：执行耗时
- `artifacts`：从 `ToolResult.artifacts` 汇总

**离线统计示例：**
```bash
# 本月 pass@1 率
jq 'select(.attempt==1) | .success' ~/.arclay/metrics/2026-03.jsonl | sort | uniq -c

# 平均耗时
jq '[.durationMs] | add/length' ~/.arclay/metrics/2026-03.jsonl
```

**约束：** 不引入新依赖，不改现有 DB schema，纯 append-only 文件。

### 为什么这么做

harness-engineering.md 原则：没有度量就没有改进。JSONL 格式轻量、离线可查、jq 直接分析，是最小可行的指标基础设施。

---

## 变更范围汇总

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `shared-types/src/tool.ts`（或 index） | 扩展 | ToolResult 加 status/summary/artifacts |
| `src-api/src/core/tools/interface.ts` | 修改 | ITool.execute 加 context 参数 |
| `src-api/src/core/tools/bash.ts` | 修改 | Error 三件套 + status + summary |
| `src-api/src/core/tools/read.ts` | 修改 | 加 summary/artifacts |
| `src-api/src/core/tools/write.ts` | 修改 | 加 artifacts（写入路径） |
| `src-api/src/core/tools/edit.ts` | 修改 | 加 artifacts |
| `src-api/src/core/agent/providers/claude.ts` | 修改 | 删 detectTaskComplexity，maxTurns=200 |
| `src-api/src/core/agent/system-prompt.ts` | 修改 | 精简至 ~25 行 |
| `src-api/src/services/agent-service.ts` | 修改 | 任务完成时写 metrics JSONL |

---

## 不在本次范围内

- 多 Agent 编排（orchestrator 已存在但未接入前端，维持现状）
- MCP/Skills 相关改动
- 前端变更
- 权限边界（trust boundary）正式化