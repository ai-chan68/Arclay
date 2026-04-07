# Development Guide

本页面向项目贡献者，描述 Arclay 的日常开发方式、代码落点和推荐工作流。

## 1. 目录职责

```text
apps/
  web/            React 前端
  agent-service/  Node.js API sidecar
  desktop/        Tauri / Rust 桌面壳
packages/
  shared-types/   前后端共享类型
```

职责划分：

- `apps/web`
  - UI、交互、任务视图、设置页
  - 本地数据库访问
  - 与 sidecar 的 HTTP/SSE 通信
- `apps/agent-service`
  - Agent harness
  - 计划 / 审批 / 执行
  - Skills / MCP / Sandbox / Runtime Gate
- `apps/desktop`
  - Tauri 壳
  - sidecar 启动
  - SQLite 初始化
- `packages/shared-types`
  - 共享消息、配置、数据库、环境类型

详细架构见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 2. 推荐开发模式

### 改前端

```bash
pnpm dev:all
```

原因：

- Vite 热更新更快
- 不需要每次等待 Rust / Tauri
- 适合组件与交互迭代

### 改 API / Agent 行为

```bash
pnpm dev:api
```

必要时再配合前端：

```bash
pnpm dev:web
```

### 验证真实桌面行为

```bash
pnpm dev
```

适用于：

- Tauri IPC
- 桌面 SQLite
- sidecar 启动
- 桌面插件行为

## 3. 启动脚本

仓库提供了统一启动脚本：

```bash
./scripts/start.sh
./scripts/start.sh --api-only
./scripts/start.sh --web-only
./scripts/start.sh --tauri
./scripts/start.sh --web-desktop
./scripts/start.sh --clean
```

脚本会：

- 清理端口
- 启动对应进程
- 写入 `logs/` 目录

## 4. 开发工作流

建议顺序：

1. 先阅读现有实现和相关文档
2. 先写计划，再编码
3. 采用 TDD
4. 完成后做代码审查
5. 最后整理 commit 和 PR

参考：

- [AGENTS.md](../AGENTS.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [.claude/rules/development-workflow.md](../.claude/rules/development-workflow.md)

## 5. 代码规范

### 通用

- 优先小文件和清晰边界
- 避免在错误层放错责任
- 新增共享类型时放到 `packages/shared-types`

### 前端

- 先沿用现有 hooks、shared lib、组件模式
- Web 模式与桌面模式行为差异要明确
- 涉及数据库或环境检测时，注意 `isTauri()` 分支

### API / Agent

- Agent sidecar 才是核心业务编排层
- 不要把复杂 Agent 逻辑放进 Rust/Tauri 层
- 新增功能优先复用现有 service、route、store、registry

### 桌面层

- 只承载桌面壳能力
- 新增 IPC 前先确认是否真的需要 IPC

## 6. 常见任务入口

### 新增前端能力

优先查看：

- `apps/web/app`
- `apps/web/components`
- `apps/web/shared/hooks`
- `apps/web/shared/lib`

### 修改 Agent 规划/执行

优先查看：

- `apps/agent-service/src/routes/agent-new.ts`
- `apps/agent-service/src/services/planning-*`
- `apps/agent-service/src/services/execution-*`

### 修改 Skills / MCP / Sandbox

优先查看：

- `apps/agent-service/src/core/agent/providers/claude.ts`
- `apps/agent-service/src/skills/*`
- `apps/agent-service/src/core/sandbox/*`

### 修改 SQLite / 桌面行为

优先查看：

- `apps/desktop/src/lib.rs`
- `apps/desktop/src/db/migrations.rs`

## 7. 本地数据与调试

本地设置和运行时元数据通常位于：

```text
~/.arclay/
```

常见内容：

- `settings.json`
- `plans.json`
- `turn-runtime.json`

工作区数据与执行历史位于：

```text
<workDir>/sessions/<taskId>/
```

## 8. 常见调试方式

### 看 API 日志

```bash
pnpm dev:api
DEBUG=* pnpm dev:api
```

### 看启动脚本日志

```text
logs/
```

### 清端口后重启

```bash
./scripts/start.sh --clean
```

### 跑单个测试定位问题

```bash
cd apps/agent-service
pnpm exec vitest run src/path/to/file.test.ts
```

## 9. 进一步阅读

- [testing.md](./testing.md)
- [deployment.md](./deployment.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [AGENTS.md](../AGENTS.md)
