# Architecture Review Notes

这份文档用于记录 `ARCHITECTURE.md` 相关的架构核验结果，目标是把已经确认的代码事实、基于事实的风险推断，以及后续待排查事项分开。

## 使用方式

- `代码事实`：已经直接对照代码确认。
- `风险推断`：基于代码事实得出的架构判断，不等同于已发生问题。
- `下一步核验`：后续需要继续检查的具体方向。
- `状态`：
  - `open`：已记录，尚未完成深入排查
  - `confirmed`：代码事实已确认
  - `closed`：完成排查，已有明确结论

## 当前总览

- 这轮核验后，5 个条目里最核心的结论不是“系统到处都不合理”，而是：代码里的真实分层已经存在，但其中有几处边界、优先级和语义没有被明确写出来。
- 条目 1 与条目 4 组合起来看，当前数据库主路径已经相对清楚：
  - `apps/desktop` 是数据库宿主与迁移执行者
  - `apps/web` 是 UI 数据主访问层
  - `db_execute` / `db_query` 已确认无调用面，应作为遗留入口删除，而不是继续保留为兼容能力
- 条目 2 说明当前系统确实是双持久化平面：
  - SQLite / IndexedDB 承载 UI 产品数据
  - sidecar 文件系统承载执行运行时状态
  - 真正待补的是恢复优先级约定，而不是强行把两边合并成一个库
- 条目 3 说明 `unknown` deliverable type 的语义当前发生了实现漂移：
  - 提示词像“保守兜底”
  - 执行代码却是默认跳过 runtime gate
- 条目 5 说明 Skills 的 source 管理并非无效，而是定位在“物料管理层”：
  - source 管安装、更新、修复、展示来源
  - runtime 真正只认项目 `SKILLs/`
  - 这是可成立分层，但容易产生产品心智错位

## 条目清单

### 1. 前端直接访问 SQLite

- 状态：`confirmed`
- 代码事实：
  - `apps/web/shared/db/database.ts` 直接通过 `@tauri-apps/plugin-sql` 打开 `sqlite:arclay.db`
  - `apps/desktop/src/lib.rs` 负责初始化数据库与注册 `tauri_plugin_sql`
  - `apps/web` 主链路未使用 `db_execute` / `db_query`
- 设计解释：
  - 当前更贴近“`apps/desktop` 负责数据库宿主与迁移，`apps/web` 负责 UI 业务数据访问”的模型，而不是“所有数据库访问都经 Rust IPC”。
  - 这一路线本身可以成立，尤其适合当前同时支持桌面 SQLite 与 Web 模式 IndexedDB 的实现。
- 真正风险：
  - Rust 与 WebView 共同指向同一个 SQLite 文件，但没有形成单一的数据库访问抽象。
  - 前端对数据库 schema 与生命周期时序有更直接耦合。
  - 在删除遗留 SQL IPC 之前，系统一度同时存在“主链路”和“遗留接口”两种数据库访问认知。
- 下一步核验：
  - 检查启动期是否存在前端先连库、迁移未完成的真实竞态
  - 检查是否已有失败恢复或重试逻辑覆盖该时序窗口
- 本轮核验结论：
  - `apps/desktop/src/lib.rs` 中数据库初始化通过 `tauri::async_runtime::spawn(...)` 异步执行，不阻塞前端应用继续启动。
  - 当前前端主链路会通过 `wait_for_db_ready` 等待数据库初始化完成，再进入 `plugin-sql`。
  - `apps/web/shared/workspace/workspace-store.tsx` 会在 `WorkspaceProvider` 挂载后的 `useEffect` 中立即调用 `dbListWorkspaces()`，因此前端首次访问 SQLite 发生得很早。
  - 在补上 `wait_for_db_ready` 之前，主链路没有共享的“等待 migration 完成”门闩，因此结构上确实存在前端先访问 SQLite、而 migration 尚未完成的竞态窗口。
  - `apps/web/shared/initialization/app-initializer.ts` 虽然存在 `initializing_database` 阶段，但 `initializeDatabase()` 明确写的是 `Database warmup skipped (lazy init)`，没有任何数据库等待或预热逻辑。
  - `apps/web/components/layout/LoadingScreen.tsx` 中 `AppInitializer` 也不会等待数据库初始化完成才渲染主 UI，而是 “Show main UI immediately, initialization happens in background”。
  - 尚未证明该窗口在真实运行中一定会稳定触发错误，但它已经不是理论猜测，而是代码结构上真实存在、且当前没有显式兜底的时序风险。

### 1A. 约定设计：UI 数据边界

- 状态：`closed`
- 建议约定：
  - `apps/desktop`
    - 负责 `arclay.db` 文件路径、数据库迁移、Tauri plugin 宿主、sidecar 生命周期
    - 不作为 UI 主数据的日常 CRUD 入口
  - `apps/web`
    - 作为 UI 产品数据的唯一访问层
    - 负责 `workspaces` / `sessions` / `tasks` / `messages` / `files` / `preview_instances` 的读写
    - 在桌面模式下使用 SQLite，在 Web 模式下使用 IndexedDB，但保持统一的数据访问接口
  - `apps/agent-service`
    - 不直接负责 UI 主数据库持久化
    - 通过 SSE/HTTP 返回运行结果，由前端数据库层决定如何落库
- 对现有代码的含义：
  - 如果接受这套设计，则“前端直接访问 SQLite”不再被视为架构偏差本身。
  - 真正需要整改的是：去掉多余的数据库访问通道，并补齐迁移时序契约。
- 当前决议：
  - 这一条边界已经可以定版：
    - `apps/web` 作为 UI 数据唯一访问层
    - `apps/desktop` 作为数据库宿主、迁移执行者与 ready 信号提供方
  - 因而后续不应再新增通过 Rust SQL IPC 直接承载 UI CRUD 的路径。

### 2. 运行时状态分散在 SQLite 与文件系统

- 状态：`closed`
- 代码事实：
  - `apps/agent-service/src/services/plan-store.ts` 使用 `plans.json`
  - `apps/agent-service/src/services/turn-runtime-store.ts` 使用 `turn-runtime.json`
  - `apps/agent-service/src/services/memory/memory-store.ts` 使用 `memory.md`、`memory/daily/*`、`history.jsonl`
  - 前端 UI 主数据仍主要落在 SQLite / IndexedDB
- 设计解释：
  - 当前系统实际上已经分成两个持久化平面：
    - UI 产品数据平面：SQLite / IndexedDB
    - Agent 执行状态平面：`plans.json`、`turn-runtime.json`、workspace 文件、`history.jsonl`、`memory.md`
  - 如果明确接受“UI 数据”和“Agent 运行时数据”分离，那么这种双平面本身是可成立的。
- 真正风险：
  - 状态恢复与排障需要跨两个持久化平面理解系统。
  - `plan` / `turn` / UI 任务状态之间的 source of truth 和优先级若不清晰，恢复路径会变复杂。
- 下一步核验：
  - 判断是否需要把“恢复优先级”显式固化进文档或代码注释
- 本轮核验结论：
  - UI 数据库平面（SQLite / IndexedDB）当前实际写入的核心对象是：
    - `workspaces`
    - `sessions`
    - `tasks`
    - `messages`
  - 对应写入入口主要集中在：
    - `apps/web/shared/workspace/workspace-store.tsx`
    - `apps/web/shared/hooks/useDatabase.ts`
    - `apps/web/shared/db/database.ts`
    - `apps/web/app/pages/TaskDetail.tsx`
  - 其中一次任务主链路上的典型写入顺序大致是：
    - 工作区初始化时 `WorkspaceProvider` 读取/补建 `workspaces`
    - 新任务创建时前端先写 `sessions`、`tasks`
    - 执行过程中流式消息由前端写入 `messages`
    - 执行结束后前端再回写 `tasks.status`
  - `files` 表虽然在 `database.ts` 中有完整实现，但当前主任务页面链路中未检索到 `createFile(...)` 的实际调用面。
  - `preview_instances` 表在桌面 migration 中存在，但当前未检索到明确的应用层写入入口。
  - sidecar 文件平面（`apps/agent-service`）当前实际写入的核心对象是：
    - `plans.json`
    - `turn-runtime.json`
    - 任务级 / turn 级 `history.jsonl`
    - turn detail（`turn.json`、`evaluation.md`、`output.md`、artifacts 拷贝）
    - `memory/daily/*.md`
    - 以及同链路里的 `context.json`、`progress.md`、附件输入文件、metrics JSONL
  - 对应关键写入点主要集中在：
    - `apps/agent-service/src/services/plan-store.ts`
    - `apps/agent-service/src/services/turn-runtime-store.ts`
    - `apps/agent-service/src/services/memory/history-logger.ts`
    - `apps/agent-service/src/services/memory/memory-store.ts`
    - `apps/agent-service/src/services/turn-detail-store.ts`
    - `apps/agent-service/src/services/agent-service.ts`
    - `apps/agent-service/src/routes/agent-new.ts`
  - 由此可以确认：当前双平面状态并不是抽象判断，而是代码中的真实分工。
  - 当前更需要明确的不是“是否双平面”，而是：
    - 哪些状态属于 UI 投影
    - 哪些状态属于执行真相源
    - sidecar 重启或恢复时谁覆盖谁
  - sidecar 重启时，当前代码中的恢复顺序已经比较明确：
    - `approvalCoordinator.markAllPendingAsOrphanedOnStartup()`
    - `planStore.sweepOnStartup()`
    - 若有过期 `plan`，再通过 `cancelTurnsForExpiredPlans(...)` 取消关联 turn
    - 最后才是 `turnRuntimeStore.sweepOnStartup()`
  - 这意味着启动恢复不是“单一状态源重建另一侧”，而是三个存储面各自清扫：
    - approval pending 先被标记为 `orphaned`
    - `plan-store` 把执行中的 plan 改成 `orphaned`，把超时待审批 plan 改成 `expired`
    - `turn-runtime-store` 再把中断中的 turn 收敛到 `failed` / `cancelled` / `idle`
  - 因此 sidecar 重启后，`plan` 与 `turn` 的终止语义并不保证完全同词：
    - 同一个执行中的任务，plan 侧可能是 `orphaned`
    - turn 侧可能是 `failed`
  - 前端页面恢复时，`TaskDetail` 会并行触发：
    - `refreshPendingRequests(taskId)`
    - `refreshTurnRuntime(taskId)`
  - 但前端并不是简单“谁先返回听谁的”，而是有一套已写进代码的优先级：
    - 对 phase 而言，pending permission / question 的优先级高于 turn runtime 映射
    - 对 `task.status` 而言，`resolveTaskStatus(...)` 的优先级是：
      - `latestApprovalTerminal` 导致的 `interruptedByApproval`
      - 手动停止
      - turn 终态映射出的 `statusFromTurnState`
      - 已有 DB `task.status`
      - 最后才退回消息推导值 `derivedStatus`
  - 也就是说，当前恢复链路里真正更“靠前”的不是 `plan`，而是：
    - UI phase 上看 approval / pending interaction
    - UI task status 上看 approval terminal 与 turn terminal
    - `plan` 主要影响还能否恢复待审批 plan，以及后续执行控制，不直接参与 `resolveTaskStatus(...)` 的比较链
  - 这说明第 2 条的核心问题不是“有无双写”，而是：
    - `plan`
    - `turn`
    - UI `task.status`
    - 三者语义不同，但目前只是在实现中形成了隐式优先级，尚未被统一写成明确约定
  - 当前决议：
    - 这条优先级应被显式写出来。
    - 优先落在架构文档中的恢复映射表，而不是先散落成代码注释。
    - 原因是这套规则横跨 sidecar 启动恢复、前端 phase 恢复、任务终态合并，属于跨模块约定，不适合只埋在单一文件注释里。
    - 代码注释可以作为后续增强，但第一落点应是 `ARCHITECTURE.md` 里的集中说明。

### 2A. 约定设计：运行时状态边界

- 状态：`closed`
- 建议约定：
  - UI 主数据库只承载用户界面需要稳定读取的产品数据：
    - `workspaces`
    - `sessions`
    - `tasks`
    - `messages`
    - `files`
    - `preview_instances`
  - `apps/agent-service` 继续独占执行运行时状态：
    - `plans.json`
    - `turn-runtime.json`
    - turn detail / artifacts / scratch
    - `history.jsonl`
    - `memory.md` / `memory/daily/*`
  - 两个平面之间只通过明确投影同步：
    - sidecar 负责执行与 SSE
    - 前端负责把用户可见的结果写入 UI 数据库
- 对现有代码的含义：
  - 不需要强行把 `plans.json` 或 `turn-runtime.json` 搬进 SQLite。
  - 更重要的是定义清楚：UI 展示状态、任务恢复状态、执行控制状态分别以谁为准。
  - 当前决议：
    - `plan`、`turn`、UI `task.status` 继续分层持有，不做存储合并。
    - 但恢复时的优先级必须以显式映射表形式对外说明。

### 3. `unknown` deliverable type 默认不启用严格 runtime gate

- 状态：`closed`
- 代码事实：
  - `apps/agent-service/src/services/execution-entry.ts` 中，`shouldEnableRuntimeGate()` 只对 `local_service` / `deployed_service` 返回 `true`
  - 同文件中，缺失 `deliverableType` 时会先被修正为 `unknown`
  - `apps/agent-service/src/services/execution-attempt-loop.ts` 中，`runtimeGateRequired === false` 时不会进入执行后的严格门控流程
- 风险推断：
  - 当模型未正确分类时，系统可能比提示词或文档预期更少做运行时验证
  - `unknown` 的运行时校验策略当前存在“命名/注释像保守兜底，但代码行为是默认跳过 gate”的心智错位
- 下一步核验：
  - 判断是否要把 runtime gate 决策从 `deliverableType` 中拆成独立字段
- 本轮核验结论：
  - `execution-entry.ts` 中的 `shouldEnableRuntimeGate()` 对“已存在 `deliverableType`”的 plan，只在类型为 `local_service` 或 `deployed_service` 时启用 runtime gate。
  - 这意味着 `unknown` 虽然语义上像“保守 fallback”，但在当前实现中并不会触发 runtime gate。
  - `execution-entry.ts` 里只在 `!plan.deliverableType` 时才退回 `isRuntimeRunIntentLegacy(...)` 做旧式关键字判定；一旦类型已经被写成 `unknown`，这条 legacy 兜底也不会再执行。
  - 因此当前真实行为不是“`unknown` 也会再做保守校验”，而是：
    - 缺失类型：可能走 legacy 关键字判定，进而开启 gate
    - 类型已是 `unknown`：默认不启用 gate
  - `execution-attempt-loop.ts` 中，当 `runtimeGateRequired === false` 时，会在执行结束后直接把 `runtimeGatePassed` 视为通过并退出循环，不会调用 `evaluateRuntimeGate(...)`。
  - 所以 `unknown` 当前默认不仅“不启用严格 gate”，而是通常根本不会进入 runtime gate 评估函数。
  - `execution-runtime-gate.ts` 本身虽然区分了 relaxed 与 strict 路径，但这只在真正调用 `evaluateRuntimeGate(...)` 时才生效；对当前 `unknown` 主路径来说，这段逻辑通常不会被执行。
  - `execution-attempt-loop.ts` 中针对 `static_files` / `data_output` / `script_execution` 的 optional failure 处理，也不能视为 `unknown` 的补偿机制，因为它同样要求前面已经进入 runtime gate 评估。
  - 目前未检索到其它上层补偿机制会专门针对 `unknown` 再做一次服务级 health check、端口校验或自动修复重试。
  - 与此同时，`apps/agent-service/src/core/agent/system-prompt.ts` 中对 `unknown` 的描述仍写的是 “Will enable runtime gate as conservative fallback”。
  - 因而第 3 条当前更准确的结论应是：
    - 代码无法证明“`unknown` 默认跳过 gate”是一个被完整贯彻的有意产品设计
    - 但可以明确证明：提示词与执行实现已经发生漂移，且当前实现侧没有发现等价的补偿逻辑
  - 当前决议：
    - 短期不把 `unknown` 直接改成严格 runtime gate。
    - 短期先修改提示词与文档，使其与当前实现对齐。
    - 中期应考虑把“交付物分类”和“是否需要 runtime gate”拆成两个独立信号，而不是继续让 `deliverableType` 同时承担两层语义。
    - 因而这条的推荐方向不是“立刻修改执行行为”，而是“先消除文档/提示词漂移，再做结构性拆分设计”。

### 4. 数据访问路径重复

- 状态：`confirmed`
- 代码事实：
  - `apps/desktop/src/lib.rs` 曾暴露 `db_execute` / `db_query`，但当前已删除
  - `apps/web` 主链路实际使用的是 `get_api_port` + `@tauri-apps/plugin-sql`
- 风险推断：
  - 系统存在两套数据库访问路径，其中一套更像保留能力
  - 新增功能时数据访问边界不够单一
- 下一步核验：
  - 确认文档与代码表述都已同步到“遗留 SQL IPC 已删除”的现状
- 本轮核验结论：
  - 全仓检索结果显示，`db_execute` / `db_query` 在删除前仅在 `apps/desktop/src/lib.rs` 中注册和实现，在业务代码中未发现实际调用面。
  - `apps/web/shared/tauri/commands.ts` 当前只封装了 `get_api_port` 和新加的 `wait_for_db_ready`，未使用 SQL IPC。
  - 因此第 4 条更准确的表述应是：
    - 删除前并不是“两套数据库主路径并行使用”
    - 而是“一套主路径（plugin-sql）+ 一套已无调用面的遗留 IPC”
  - 当前决议：
    - 既然 `db_execute` / `db_query` 已确认无实际使用，就不再建议继续保留。
    - 这两个 IPC 的注册与实现现已删除。

### 5. Skills 来源管理与运行时加载模型不完全一致

- 状态：`closed`
- 代码事实：
  - `apps/agent-service/src/skills/skill-scanner.ts` 的 `getAllSkills()` 只扫描项目内 `SKILLs/`
  - `apps/agent-service/src/skills/router.ts` 路由候选来自 `getAllSkills(projectRoot)`
  - `apps/agent-service/src/routes/settings.ts` 明确写了 “现在只从项目 SKILLs/ 目录加载”
  - `settings-store.ts` 中仍有 `sources` 配置与相关来源管理结构
- 风险推断：
  - 产品语义上支持“来源管理”，但运行时最终候选仍取决于是否被同步/导入进 `SKILLs/`
- 下一步核验：
  - 评估是否需要在设置接口或 UI 上进一步区分“source 管理”和“已安装 skills”
- 本轮核验结论：
  - `settings-store.ts` 中的 `skills.sources` 会持久化到 `settings.json`，属于全局 Skills 管理配置的一部分。
  - `routes/settings.ts` 中 `/api/settings/skills/sources` 相关接口，主要就是对这份 `sources` 配置做增删改查。
  - 也就是说，source 配置本身首先是“管理层配置”，不是运行时扫描入口。
  - 真正的安装 / 更新链路是：
    - `install`
    - `update`
    - `repair`
    - `import`
    - 这些接口会调用 `ecosystem-service.ts` 或 import 逻辑，把 skill 目录复制/导入到项目 `SKILLs/`
  - `routes/settings.ts` 中 `/api/settings/skills/import` 在 GitHub URL 场景下，还会额外：
    - 自动注册 source 到 `settings.skills.sources`
    - 把导入后的 `skillId -> sourceId` 写入 `.arclay/skill-source-bindings.json`
  - `source-binding-store.ts` 的职责是记录“某个已落到项目里的 skill 来自哪个 source”，用于列表展示和后续 update / repair 选择来源。
  - 但运行时加载并不直接读取 `sources`：
    - `skill-scanner.ts` 的 `getAllSkills(projectRoot)` 只扫描 `projectRoot/SKILLs`
    - `router.ts` 的 `routeSkillsForPrompt(...)` 只基于 `getAllSkills(projectRoot)` 的结果、skill enable 配置和 routing 配置做路由
    - 当前代码里没有看到 `routeSkillsForPrompt(...)` 直接读取 `settings.skills.sources`
  - 这意味着 source 配置不会直接决定“当前路由候选有哪些”。
  - source 只能通过“安装/更新后把物料写入 `SKILLs/`”间接影响运行时候选集。
  - 反过来说，如果只是把某个 source 从 settings 里删除，并不会自动把已经落在 `SKILLs/` 下的 skill 卸载掉；删除 source 记录与移除运行时 skill 目录不是同一件事。
  - `/api/settings/skills/list` 会把：
    - `SKILLs/` 中扫描出来的 skill
    - `.arclay/skill-source-bindings.json` 中的绑定关系
    - `settings.skills.sources` 中的 source 元信息
    - 三者拼起来给前端展示 `sourceInfo`
  - 因此当前的“来源管理”更多是：
    - 管 skill 从哪里来
    - 是否允许 update / repair
    - 在列表里显示来源信息
    - 而不是直接作为运行时路由开关
  - 此外还存在一个实现层细节：
    - HTTP 层 `services/skills-service.ts` 与 runtime 层 `skills/skill-scanner.ts` 各自维护了一套扫描 `SKILLs/` 的实现
    - 它们当前结论一致，但从维护角度看属于重复实现
  - 所以第 5 条更准确的结论应是：
    - 当前并不是“sources 与 runtime 完全脱节”
    - 而是“sources 负责管理和物料入库，runtime 只认入库后的 `SKILLs/`”
    - 这是一种可以成立的分层
    - 但如果产品或使用者把来源列表理解成“当前可用 skill 的直接控制面板”，就会产生明显的心智错位
  - 当前决议：
    - 短期不修改运行时加载逻辑。
    - 短期先在接口、文档或设置页文案中明确写出：
      - `sources` 影响安装 / 更新 / 修复
      - `sources` 不直接决定运行时路由候选
      - 运行时仍以项目 `SKILLs/` 中已入库的 skills 为准
    - 中期如果产品仍然容易误解，可再考虑把“source 管理”和“已安装 skills”拆成更显式的两个概念层。

## 面向约定设计的代码改造思路

### Phase 1. 明确并固化边界，不急着大改

- 在 `ARCHITECTURE.md` 中显式写清：
  - `apps/desktop` 是数据库宿主与迁移执行者
  - `apps/web` 是 UI 主数据访问层
  - `apps/agent-service` 是运行时状态持有者
- 在 `apps/web/shared/db/` 顶层补文档注释，声明这是 UI 数据访问抽象层，而不是“临时前端直连数据库”
- 在 `apps/agent-service/src/routes/agent-new.ts` 附近补文档注释，强调后端不负责 UI 主数据库持久化

### Phase 2. 收口 UI 数据访问通道

- 全仓核验 `db_execute` / `db_query` 的真实调用面
- 已确认无业务依赖后，直接删除这两个遗留 SQL IPC
- 保持 `apps/web/shared/db/database.ts` 作为唯一 UI 数据访问入口，避免新增其它 SQLite 访问方式

### Phase 3. 补齐数据库启动时序契约

- 调查前端首次 `Database.load('sqlite:arclay.db')` 是否可能早于 migration 完成
- 如果存在时序窗口，优先考虑轻量方案：
  - 在前端数据库初始化前增加“数据库 ready”探测
  - 或让 desktop 暴露一个明确的 `db_ready` / `wait_for_db_ready` IPC
- 目标不是改变 ownership，而是保证“宿主迁移完成后，前端再进入 UI 数据访问”

### 条目 1 的建议最小修复方案

- 目标：
  - 不改变“`apps/desktop` 负责迁移，`apps/web` 负责 UI 数据访问”的约定设计
  - 只补齐 SQLite 首次访问前的 ready 门闩
- 推荐方案：
  - 在 `apps/desktop/src/lib.rs` 新增只读 IPC：`wait_for_db_ready`
  - 该 IPC 复用现有 `DB_READY` / `DB_POOL` 语义：
    - 已 ready 时立即返回
    - 未 ready 时等待迁移完成
    - 初始化失败时返回明确错误，而不是无限等待
  - 在 `apps/web/shared/tauri/commands.ts` 暴露 `waitForDesktopDbReady()`
  - 在 `apps/web/shared/db/database.ts` 的 `getSQLiteDatabase()` 中加入一次性等待：
    - 仅桌面模式执行
    - 只在首次真正访问 SQLite 前等待一次
    - 之后复用已建立的 `sqliteDb` 连接
- 可选增强：
  - 将 `apps/web/shared/initialization/app-initializer.ts` 的 `initializeDatabase()` 从“占位阶段”升级为真正 warmup：
    - 先调用 `waitForDesktopDbReady()`
    - 再触发一次数据库模块初始化
  - 但这不是必需项，真正的门闩应放在 `database.ts` 统一入口
- 不推荐方案：
  - 仅在前端做失败重试，不建立 desktop-ready 信号
  - 直接把所有 SQLite 访问搬回 Rust IPC（改动过大，不是这个问题的最小修复）

### Phase 4. 明确双平面同步规则

- 梳理以下状态的权责：
  - 任务列表中的 `status` / `phase`
  - `planStore` 中的 plan 状态
  - `turnRuntimeStore` 中的 turn 状态
  - 文件系统中的 `history.jsonl` / turn detail
- 为恢复流程补一份映射表：
  - 哪些字段仅用于 UI 展示
  - 哪些字段是运行控制真相源
  - sidecar 重启时谁覆盖谁

### Phase 5. 只在必要时考虑更大改造

- 若后续发现 plugin-sql 直连模式在迁移、权限、审计或并发上持续带来复杂性，再评估是否把所有 SQLite 访问收口到 Rust IPC
- 在当前阶段，不建议直接把 `apps/web` 的所有数据库访问整体搬回 `apps/desktop`
- 优先做“边界澄清 + 冗余通道收口 + 时序契约补齐”

## 当前未决事项

- 当前无新的未决事项；若继续推进，下一阶段应从“核验底稿”转为“把已达成决议落实到文档、接口文案或代码结构”。

## 备注

- 这份文档记录的是“核验工作底稿”，不是最终架构结论。
- 对某条是否改成 `closed`，取决于是否已经形成团队愿意采纳的约定或决策，而不只是“代码事实已经查到”。
