# Arclay Architecture

Arclay 是一个桌面优先的 AI 开发工作台。生产形态是 Tauri 桌面应用，核心运行时由三部分组成：

- React 前端：负责任务界面、审批交互、消息流展示、本地数据读取。
- Node.js API Sidecar：负责 Agent 编排、两阶段执行、Skills/MCP/Sandbox 集成。
- Rust/Tauri 主进程：负责桌面壳能力、Sidecar 拉起、SQLite 初始化与桌面插件能力。

这份文档描述的是当前代码实现，而不是 README 中的抽象目标图。

## 1. 系统总览

### 1.1 生产运行拓扑

```text
┌──────────────────────────────────────────────────────────────┐
│ Arclay.app                                                  │
│                                                              │
│  ┌─────────────────────────────┐                             │
│  │ React UI in Tauri WebView   │                             │
│  │ apps/web                    │                             │
│  │ - useAgentNew               │                             │
│  │ - Task / Settings / Notes   │                             │
│  └──────────────┬──────────────┘                             │
│                 │                                            │
│      HTTP / SSE │                 Tauri IPC / Plugins        │
│                 │                                            │
│  ┌──────────────▼──────────────┐   ┌───────────────────────┐ │
│  │ API Sidecar (Node.js)       │   │ Rust / Tauri Runtime  │ │
│  │ apps/agent-service          │   │ apps/desktop          │ │
│  │ - Plan / Execute routes     │   │ - sidecar lifecycle   │ │
│  │ - Claude Agent SDK          │   │ - app data path       │ │
│  │ - SandboxService            │   │ - SQLite migrations   │ │
│  │ - MCP / Skills routing      │   │ - get_api_port IPC    │ │
│  └─────────────────────────────┘   └───────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 代码边界

- `apps/web`
  - 用户界面与状态管理。
  - 通过 HTTP/SSE 调用 agent-service。
  - 在桌面模式下通过 Tauri API 读取 Sidecar 端口，并通过 `@tauri-apps/plugin-sql` 访问 SQLite。
- `apps/agent-service`
  - 真正的 Agent Harness。
  - 持有规划、审批、执行、运行时门控、Skills 路由、MCP 装配、Sandbox 策略。
- `apps/desktop`
  - 桌面外壳。
  - 启动时初始化数据库、拉起 sidecar、暴露少量 IPC 能力。
- `packages/shared-types`
  - 前后端共享消息、计划、配置、数据库、环境类型。

## 2. 双进程架构详解

### 2.1 为什么是双进程

Arclay 把“系统壳”和“Agent Harness”分离：

- Rust/Tauri 主进程负责桌面可信边界。
  - 初始化应用数据目录。
  - 启动 Node sidecar。
  - 维护原生插件能力。
- Node sidecar 负责高变化率的 AI 编排逻辑。
  - Hono API。
  - Claude Agent SDK。
  - Skills / MCP / Sandbox / Approval / Turn runtime。

这样做的直接收益：

- Rust 层不承载复杂 Agent 业务逻辑。
- Agent 运行时可以沿用 Node 生态与 TypeScript 类型系统。
- UI 与 Agent 可以通过稳定的 HTTP/SSE 协议解耦。

### 2.2 Sidecar 生命周期

Tauri 启动时：

1. Rust 先初始化 SQLite。
2. 根据环境决定是否自动拉起 `arclay-api` sidecar。
3. 监听 sidecar stdout，解析实际监听端口。
4. 通过 `get_api_port` IPC 提供给前端。

关键实现：

- `apps/desktop/src/lib.rs`
- `apps/agent-service/src/index.ts`
- `apps/web/shared/tauri/commands.ts`

### 2.3 当前真实数据边界

一个容易混淆的点：

- Agent sidecar 不直接访问 Rust SQLite。
- 前端也不是主要通过自定义 `db_execute` / `db_query` IPC 访问数据库。
- 当前主路径是前端通过 `@tauri-apps/plugin-sql` 直接打开 `sqlite:arclay.db`。

因此当前运行时实际上有两个持久化平面：

- SQLite：会话、任务、消息、文件、设置、预览实例。
- 文件系统 JSON/JSONL：计划审批状态、回合运行时状态、历史流水、memory。

## 3. Tauri IPC vs HTTP/SSE 通信机制

### 3.1 通信矩阵

| 通道 | 方向 | 用途 | 特性 |
|---|---|---|---|
| HTTP | UI → sidecar | 普通 API 调用 | 请求/响应，适合配置、查询、管理 |
| SSE | UI ← sidecar | Agent 规划/执行流式消息 | 单向持续流，适合长任务 |
| Tauri IPC (`invoke`) | UI ↔ Rust | 桌面本地能力 | 低延迟、本地调用、非流式 |
| Tauri plugins | UI ↔ Rust/plugin | SQLite / FS / Dialog 等 | 桌面能力封装，偏同步语义 |

### 3.2 为什么 Agent 流走 HTTP/SSE

规划和执行都可能持续几十秒到数分钟，并会产生大量中间消息：

- `session`
- `text`
- `plan`
- `tool_use`
- `tool_result`
- `permission_request`
- `clarification_request`
- `turn_state`
- `done`

这类消息天然适合 SSE：

- 前端可以边收边渲染。
- Sidecar 可以用 async generator 逐步产出消息。
- 不需要把 Agent 过程压缩成一次 RPC 返回。

前端主入口：

- `apps/web/shared/hooks/useAgentNew.ts`
- `apps/web/shared/api/index.ts`

后端主入口：

- `POST /api/v2/agent/plan`
- `POST /api/v2/agent/execute`

### 3.3 为什么桌面能力走 Tauri IPC / 插件

以下能力属于本机可信边界：

- 获取实际 sidecar 端口。
- 访问桌面 SQLite。
- 文件系统、弹窗、通知、剪贴板等本机能力。

这些不需要流式，也不适合暴露给 sidecar 作为远程 API，因此放在 Tauri IPC 或插件层。

### 3.4 当前 IPC 现状

当前自定义 `invoke_handler` 暴露了：

- `get_api_port`
- `is_desktop`
- `db_execute`
- `db_query`

但前端主链路里实际使用到的是：

- `get_api_port`
- `@tauri-apps/plugin-sql`

因此 `db_execute` / `db_query` 更像保留能力，而不是前端数据库主路径。

## 4. 数据库设计（SQLite Schema）

### 4.1 数据库定位

SQLite 主要承载 UI 可见的核心业务实体，不直接承载 Agent 执行控制状态。

数据库初始化位置：

- `apps/desktop/src/lib.rs`
- `apps/desktop/src/db/migrations.rs`

特征：

- SQLite + WAL
- 启动时自动迁移
- 当前 schema version = `5`

### 4.2 表结构

#### `schema_version`

记录迁移版本：

- `version`
- `applied_at`

#### `sessions`

会话聚合根：

- `id`
- `prompt`
- `task_count`
- `created_at`
- `updated_at`

#### `tasks`

单个任务实例：

- `id`
- `session_id`
- `task_index`
- `prompt`
- `title`
- `status`
- `phase`
- `cost`
- `duration`
- `favorite`
- `selected_artifact_id`
- `preview_mode`
- `is_right_sidebar_visible`
- `created_at`
- `updated_at`

说明：

- `status` 偏最终结果，如 `running` / `completed` / `error` / `stopped`。
- `phase` 记录更细粒度的任务阶段。
- 预览相关字段用于 artifact 侧边栏与预览状态恢复。

#### `messages`

任务消息流的持久化快照：

- `id`
- `task_id`
- `type`
- `role`
- `content`
- `tool_name`
- `tool_input`
- `tool_output`
- `tool_use_id`
- `error_message`
- `attachments`
- `created_at`

说明：

- 这是前端消息列表的持久化基础。
- 结构上允许同时承载普通文本、工具调用、错误、附件等多种消息。

#### `files`

任务产出物索引：

- `id`
- `task_id`
- `name`
- `type`
- `path`
- `preview`
- `thumbnail`
- `is_favorite`
- `artifact_type`
- `file_size`
- `preview_data`
- `created_at`

说明：

- `artifact_type` 用于区分预览/结果类型。
- `preview` / `thumbnail` / `preview_data` 支撑库视图和右侧预览。

#### `settings`

简单键值配置：

- `key`
- `value`
- `updated_at`

注意：Agent provider、MCP、Skills、Approval、Sandbox 的主配置当前仍主要落在 `~/.arclay/settings.json`，SQLite 的 `settings` 表不是唯一配置源。

#### `preview_instances`

预览实例信息：

- `id`
- `task_id`
- `port`
- `status`
- `url`
- `created_at`
- `last_accessed`

### 4.3 索引

当前显式索引包括：

- `idx_tasks_session_id`
- `idx_messages_task_id`
- `idx_files_task_id`
- `idx_preview_instances_task_id`
- `idx_files_artifact_type`

### 4.4 数据库之外的运行时存储

以下关键状态不在 SQLite，而在 `~/.arclay` 或工作目录文件系统中：

- `settings.json`
- `plans.json`
- `turn-runtime.json`
- `sessions/<taskId>/history.jsonl`
- `sessions/<taskId>/turns/<turnId>/history.jsonl`
- `memory.md` 与 `memory/daily/*`

这是当前架构必须明确的一点：SQLite 不是全部状态源。

## 5. 两阶段执行流程详解

### 5.1 设计目标

Arclay 把“想做什么”和“如何执行”拆开：

1. Planning
2. Approval
3. Execution

这样做是为了让用户可以在真正执行前看到：

- 目标
- 步骤
- 可交付物类型
- 是否需要本地运行时验证

### 5.2 Phase 1: Planning

入口：

- `POST /api/v2/agent/plan`

核心步骤：

1. 前端 `useAgentNew` 发起规划请求并建立 SSE。
2. Sidecar 创建 `runId` 和 `turn`。
3. `AgentService.createAgent().plan(...)` 进入 Claude planning 流。
4. 流式消息经 `planning-session` / `planning-stream-loop` 处理。
5. 若得到 `TaskPlan`，写入 `planStore`，并把 turn 标记为 `awaiting_approval`。
6. 前端显示计划审批 UI。

规划阶段的关键信号：

- `plan`
- `clarification_request`
- `permission_request`
- `turn_state`
- `done`

相关模块：

- `apps/agent-service/src/routes/agent-new.ts`
- `apps/agent-service/src/services/planning-session.ts`
- `apps/agent-service/src/services/planning-entry.ts`
- `apps/agent-service/src/services/planning-stream-loop.ts`
- `apps/agent-service/src/services/planning-post-run.ts`

### 5.3 Approval

审批不是前端本地状态，而是 sidecar 的显式运行时状态机：

- `planStore` 管理 plan 生命周期。
- `approvalCoordinator` 管理权限请求和澄清问题。
- `turnRuntimeStore` 管理 turn 生命周期和依赖。

plan 可能进入的状态：

- `pending_approval`
- `executing`
- `executed`
- `rejected`
- `expired`
- `orphaned`

turn 可能进入的状态：

- `queued`
- `analyzing`
- `planning`
- `awaiting_approval`
- `awaiting_clarification`
- `executing`
- `blocked`
- `completed`
- `failed`
- `cancelled`

### 5.4 Phase 2: Execution

入口：

- `POST /api/v2/agent/execute`

核心步骤：

1. 校验 plan 是否仍有效。
2. 校验 turn 版本与阻塞依赖。
3. 根据 `TaskPlan` 构造 execution prompt。
4. 创建 execution session。
5. Agent 按计划执行工具。
6. 收集运行观测，评估 runtime gate。
7. 如需要，可自动重试一次修复。
8. 执行结束后更新 plan / turn 生命周期，并发送 `done`。

相关模块：

- `execution-entry.ts`
- `execution-session.ts`
- `execution-attempt-loop.ts`
- `execution-post-run.ts`
- `execution-lifecycle.ts`

### 5.5 补充：恢复与扫尾

API 启动时会进行恢复：

- 孤儿化未完成审批。
- 过期 pending plan。
- 重置中断的 runtime / turn 状态。

实现：

- `runtime-recovery-bootstrap.ts`

这保证了 sidecar 重启后不会把旧的 pending 运行态错误地当成仍然有效。

## 6. 沙箱执行机制

### 6.1 角色定位

Sandbox 不是简单“执行命令”的封装，而是 Agent 执行的受控边界：

- 统一命令执行入口。
- 提供 provider 选择与降级。
- 限制工作目录外访问。
- 结合策略层阻断高风险或不适配操作。

### 6.2 Sandbox 分层

```text
Claude Agent SDK tool call
  -> tool execution policy
  -> Sandbox MCP tools / SandboxService
  -> sandbox provider
  -> local/native or external sandbox runtime
```

关键模块：

- `core/sandbox/interface.ts`
- `core/sandbox/registry.ts`
- `core/sandbox/sandbox-service.ts`
- `core/sandbox/providers/native.ts`
- `core/agent/policy/tool-execution-policy.ts`

### 6.3 Provider 模型

当前支持的 provider 类型：

- `native`
- `claude`
- `docker`
- `e2b`

当前默认与兜底都是 `native`。

`SandboxService.create()` 会：

1. 初始化 provider registry。
2. 根据请求 provider 解析可用 provider。
3. 如果目标 provider 不可用，自动 fallback。

### 6.4 原生 provider 的实际行为

`native` provider 不提供真正的进程隔离，它做的是：

- 工作目录限制
- 文件路径校验
- 命令超时与进程组杀死
- 文件读写封装

因此“沙箱”在当前实现中更接近：

- 受限工作区执行器
- 可被更强 provider 替换的抽象层

### 6.5 策略层约束

真正的风险控制主要在 `tool-execution-policy.ts`：

- 开启 sandbox 时，拒绝直接使用宿主 `Bash`。
- 在 sandbox 命令中阻断长时运行命令。
  - `http.server`
  - `npm run dev`
  - `pnpm dev`
  - `vite`
  - `flask run`
  - `uvicorn`
  - `runserver`
  - 以 `&` 结尾的后台命令
- 拒绝写出 session 目录之外的文件。
- 配置过的 MCP server 默认低风险放行。

### 6.6 为什么要阻断长时运行命令

因为 sandbox 任务的默认语义是“可结束的命令执行”，而不是“长期驻留服务”。如果把 `npm run dev` 或 `python -m http.server` 放进 sandbox：

- 命令会超时。
- Agent 会误认为执行失败。
- runtime gate 会触发不必要的自动修复循环。

所以当前策略是：

- 运行本地服务类任务时，优先把它们视为 `local_service`。
- 在执行层单独做健康检查，而不是在 sandbox 中无限挂起。

## 7. MCP 集成架构

### 7.1 配置来源

MCP 配置来自 `settings.json`：

- `enabled`
- `mcpServers`
  - `stdio`
  - `http`
  - `sse`

类型定义：

- `packages/shared-types/src/config.ts`
- `apps/agent-service/src/settings-store.ts`

### 7.2 装配路径

配置进入运行时的路径：

1. 前端设置页保存 MCP 配置。
2. `settings-store` 持久化到 `~/.arclay/settings.json`。
3. `app-runtime.ts` 在构造 `AgentServiceConfig` 时生成 `mcp` 配置。
4. `ClaudeAgent.buildQueryOptions()` 调用 `loadMcpServers()`。
5. 配置被转换为 Claude Agent SDK 的 `mcpServers` 结构。

### 7.3 Sandbox 与 MCP 的关系

当 sandbox 启用时，Claude provider 会额外注入一个虚拟 MCP server：

- 名称：`sandbox`
- 工具：
  - `sandbox_run_script`
  - `sandbox_run_command`

这意味着 sandbox 工具在 Claude 看来也是 MCP 工具，只是它们由 Arclay 自己注入并指向 `/api/sandbox/*`。

### 7.4 MCP 使用边界

执行 prompt 会明确告诉模型：

- 只能使用当前 session 已暴露的 MCP server。
- 不要通过 Bash 到处探测其他应用或 home 目录里的 MCP 配置。
- 如果工具没暴露，就明确说明当前应用未配置。

这避免了“环境考古式”的不可控行为。

## 8. Skills 系统架构

### 8.1 Skills 来源

Arclay 当前只使用项目内 `SKILLs/` 作为主技能源。

扫描逻辑：

- 遍历 `SKILLs/*/SKILL.md`
- 解析 frontmatter
- 生成 `SkillInfo`

关键模块：

- `skills/skill-scanner.ts`
- `skills/router.ts`
- `skills/index-store.ts`
- `services/skills-service.ts`

### 8.2 Skills 路由

Skills 不是盲目全部注入，而是先路由再同步：

1. 从 prompt 提取关键词。
2. 结合 skill metadata 计算匹配分数。
3. 叠加历史成功率、最近使用时间。
4. 根据 routing 配置选择 top N。
5. 为内部交互网页任务提高 browser/playwright 类 skill 权重。

路由模式：

- `off`
- `assist`
- `auto`

### 8.3 会话级技能同步

Claude provider 在每次 query 前会把选中的 skill 同步到：

```text
<sessionCwd>/.claude/skills/
<sessionCwd>/.claude/skills/active/
```

这样做的原因：

- 避免并发任务互相污染。
- 保证每次 Agent 会话只看到当前任务允许的 skills。
- 不依赖全局 `~/.claude/skills/`。

### 8.4 Skills 与设置

用户可以在设置里控制：

- Skills 总开关
- 单 skill enable/disable
- provider 兼容性开关
- routing 模式、阈值、topN
- 外部来源管理

### 8.5 运行时观测

技能路由结果不是静态配置，系统会记录：

- successCount
- failureCount
- lastUsedAt
- latency

这些反馈又会回流到后续路由分数中。

## 9. 可交付物类型系统

### 9.1 目的

可交付物类型系统用于回答一个关键问题：

“这次任务完成后，是否应该存在一个可验证的运行时服务？”

这决定：

- 是否需要 runtime gate
- 是否需要健康检查
- sandbox 应该如何约束

### 9.2 类型定义

`packages/shared-types/src/agent.ts`

- `static_files`
- `local_service`
- `deployed_service`
- `script_execution`
- `data_output`
- `unknown`

### 9.3 类型进入流程的时间点

在 Planning 阶段，模型输出的 `TaskPlan` 就应该包含 `deliverableType`。

随后在执行入口：

- `execution-entry.ts` 先校验和必要时自动纠正类型。
- 再据此决定是否开启 runtime gate。

### 9.4 自动纠正规则

当前有几类显式修正：

- 如果写的是“单个 HTML 文件/静态 HTML”，却被标成 `local_service`，修正为 `static_files`。
- 如果写的是“启动本地服务 / npm dev”，却被标成 `static_files`，修正为 `local_service`。

这一步是为了防止模型误分类导致错误的运行时验证。

## 10. 运行时门控机制

### 10.1 核心思想

runtime gate 是执行结束后的“可运行性验证器”，不是执行器本身。

它回答的问题是：

- 如果任务承诺交付一个本地服务，它是否真的启动并健康？
- 如果只是静态文件或数据输出，是否应该跳过服务级验证？

### 10.2 门控策略

当前策略：

- `static_files` / `script_execution` / `data_output`
  - 默认不做严格运行时门控。
  - 只在明显端口冲突等场景下认为异常。
- `local_service` / `deployed_service`
  - 启用严格 runtime gate。
- `unknown`
  - 保守路径，倾向严格检查。

### 10.3 观测来源

执行过程中系统会累计 `ExecutionObservation`：

- 执行过的命令
- 命令或输出里发现的 loopback URL
- health check 通过的 URL
- 端口提示
- 前端/后端启动命令次数
- 端口冲突信息

### 10.4 健康探测过程

系统会：

1. 从命令和输出中提取 URL 与端口。
2. 推导候选地址。
3. 对候选地址发起 `fetch` 健康探测。
4. 判断是否满足：
   - frontend 期望已健康
   - backend 期望已健康

### 10.5 自动修复循环

如果 runtime gate 失败且任务属于严格门控类型：

1. 生成 runtime auto-repair 消息。
2. 把失败原因拼回 repair prompt。
3. 再执行一轮。

当前默认最大修复次数较小，目标是避免无限循环。

### 10.6 与 turn / progress 的关系

runtime gate 的结果会同时写入：

- SSE 消息流
- progress 日志
- turn 生命周期

因此它既是验证机制，也是用户可见的运行时反馈机制。

## 11. 任务工作区与运行时文件布局

工作区布局由 `workspace-layout.ts` 统一定义：

```text
<workDir>/
  sessions/<taskId>/
    context.json
    history.jsonl
    inputs/
    runs/<runId>/
    turns/<turnId>/
      history.jsonl
      artifacts/
        final/
        intermediate/
      scratch/
```

其中：

- `history.jsonl` 是执行流水，不是最终产物。
- 最终交付物应该进入 turn 级 `artifacts/final/`。
- 中间保留物进入 `artifacts/intermediate/`。
- 临时脚本进入 `scratch/`。

此外，全局运行时元数据位于：

```text
~/.arclay/
  settings.json
  plans.json
  turn-runtime.json
```

## 12. 前端与桌面模式差异

### 12.1 桌面模式

- 真实生产模式。
- 前端运行在 Tauri WebView。
- 通过 `get_api_port` 找到 sidecar 端口。
- 通过 `plugin-sql` 访问 SQLite。

### 12.2 Web 开发模式

- 只用于开发与 E2E。
- 前端与 API 各自独立运行。
- 数据落到 IndexedDB，而不是桌面 SQLite。

这意味着：

- Web 模式数据不与桌面版共享。
- 任何涉及 Tauri IPC、桌面插件、真实 SQLite 的验证，都必须在桌面模式完成。

## 13. 当前架构结论

Arclay 当前架构的关键点可以总结为：

- 它不是单体前端，也不是单进程桌面应用，而是 Tauri 壳 + Node sidecar 的双进程系统。
- Agent 的真正工程逻辑集中在 `apps/agent-service`，而不是 Rust 层。
- 流式任务走 HTTP/SSE，本机能力走 Tauri IPC / 插件，这是明确分工。
- SQLite 只承载 UI 主数据；计划审批、turn runtime、history、memory 主要在文件系统。
- Deliverable Type + Runtime Gate 是执行可靠性的核心机制。
- Skills、MCP、Sandbox 都不是外围功能，而是 Agent Harness 的一级能力。

## 14. 关键源码索引

- 运行时装配
  - `apps/agent-service/src/index.ts`
  - `apps/agent-service/src/runtime/app-runtime.ts`
- 两阶段执行
  - `apps/agent-service/src/routes/agent-new.ts`
  - `apps/agent-service/src/services/planning-session.ts`
  - `apps/agent-service/src/services/execution-session.ts`
- runtime gate / deliverable type
  - `apps/agent-service/src/services/execution-entry.ts`
  - `apps/agent-service/src/services/execution-runtime-gate.ts`
  - `packages/shared-types/src/agent.ts`
- sandbox
  - `apps/agent-service/src/core/sandbox/sandbox-service.ts`
  - `apps/agent-service/src/core/sandbox/providers/native.ts`
  - `apps/agent-service/src/core/agent/policy/tool-execution-policy.ts`
- MCP / Skills
  - `apps/agent-service/src/core/agent/providers/claude.ts`
  - `apps/agent-service/src/skills/router.ts`
  - `apps/agent-service/src/skills/skill-scanner.ts`
- 数据库
  - `apps/desktop/src/lib.rs`
  - `apps/desktop/src/db/migrations.rs`
  - `apps/web/shared/db/database.ts`
  - `apps/web/shared/tauri/commands.ts`
