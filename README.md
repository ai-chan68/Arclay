# EasyWork

EasyWork 是一个基于 **Harness Engineering（装备工程）** 理念构建的开源 AI 工作台。它专注于“真实执行”而非简单的聊天，将自然语言任务转化为可规划、可审批、可执行、可恢复的自动化流程。

在 EasyWork 中，我们认为 **Agent 是训练出来的模型，而 Harness（工具、观测、权限、知识）才是工程师编写的代码**。本项目即为这一理念的完整实践。

核心定位：
- **Harness 驱动**：基于 **Claude Agent SDK** 深度集成，不仅是对话，更是对本地环境（文件、命令、API）的深度装备与控制
- **确定的执行流**：遵循 `Planning -> Approval -> Execution` 范式，拒绝黑盒操作
- **专业开发者工作台**：深度集成 Sandbox、MCP 与 Skills 路由器，面向本地项目真实产出

- English README：[`README_EN.md`](./README_EN.md)

## 为什么做这个项目

很多 AI 产品擅长回答问题，但不擅长把任务稳定地做完。  
EasyWork 关注的是另一件事：

- 如何让 AI 任务有明确阶段和状态
- 如何让用户在执行前看到计划并决定是否继续
- 如何把工具调用、审批、澄清、文件、结果都放进一个统一工作台
- 如何让任务可以回看、继续、恢复、调度，而不是一次性聊天结束

如果你也在做 Agent、桌面 AI、任务编排、审批流、工具调用或本地工作区集成，EasyWork 希望能成为一个可运行、可参考、可扩展的开源基础项目。

## Harness Engineering 理念

EasyWork 的核心是 **Harness（装备）**，我们为模型提供专业、稳定且受控的工作环境：

- **精细化 Action Space**：按需设计 Micro/Medium/Macro 不同粒度的工具，确保职责唯一且安全受控。
- **结构化 Observation**：所有工具响应符合统一协议（Success/Warning/Error），包含 Root Cause 与下一步操作建议，确保 Agent 能自主决策与恢复。
- **Error Recovery Contract**：遵循 `root_cause_hint + safe_retry_instruction + stop_condition` 契约，避免任务陷入静默失败或无限循环。
- **隔离与并行**：支持子 Agent 消息隔离与基于 Git Worktree 的任务并行，确保环境整洁与安全边界。

## 核心特性

- **两阶段执行流**：遵循 `Planning -> Approval -> Execution` 范式，支持任务分解预览与审批后执行。
- **任务工作台**：一体化的 Timeline、过程追溯、结果对比与文件产物实时预览。
- **本地生态系统**：
  - **Sandbox**：原生命令执行沙箱，支持 stdout/stderr 显式分离与权限管控。针对 Bash Tool 建立了明确的 **Error Contract**，能够识别并自主处理“超时 (Timeouts)”与“缺失二进制文件 (Missing Binaries)”等异常，确保持续执行。
  - **MCP 集成**：深度支持 Model Context Protocol，实现资源与工具的动态注入。
  - **Skills 路由器**：高效的任务路由机制，优化 Context Budgeting 并提升长任务稳定性。
- **运行时可观测性**：支持任务全生命周期的执行审计、断点续传与自动化调度。

## 快速开始

### 环境要求

- Node.js `>= 20`
- pnpm `>= 9`
- Git
- Rust stable（仅桌面模式）
- Tauri prerequisites（仅桌面模式）：<https://v2.tauri.app/start/prerequisites/>

### 安装

```bash
git clone <your-repo-url>
cd EasyWork

corepack enable
corepack prepare pnpm@9 --activate
pnpm install
```

### 开发运行

```bash
# Web 联调（推荐）
pnpm dev:all

# 单独启动
pnpm dev:api
pnpm dev:web

# 桌面调试（Tauri）
pnpm dev
```

默认端口：

- API: `http://localhost:2026`
- Web: `http://localhost:1420`

### 首次启动后

1. 打开应用并进入 `/welcome`
2. 在 Settings 中配置至少一个 Provider
3. 激活 Provider
4. 输入任务，进入 `计划 -> 审批 -> 执行`
5. 在任务详情页查看 timeline、过程、结果和产物

运行时设置与持久化数据：

- 配置：`~/.easywork/settings.json`（模型 Provider、沙箱偏好等）
- 任务与规划：`~/.easywork/plans.json` & `~/.easywork/tasks.json`
- 审批队列：`~/.easywork/approval-requests.json`
- 调度记录：`~/.easywork/scheduled-tasks.json`
- 运行时上下文：`~/.easywork/turn-runtime.json`（Agent 内部状态持久化）

## 常用命令

```bash
# 开发
pnpm dev:all
pnpm dev:api
pnpm dev:web
pnpm dev

# 质量检查
pnpm lint
pnpm typecheck
pnpm test
pnpm smoke:desktop:with-api
pnpm pre-release

# 构建
pnpm build
pnpm build:api
pnpm build:desktop
```

## 项目结构

```text
src/            前端（React + Vite）
src-api/        后端（Hono + Claude Agent SDK）
src-tauri/      桌面壳（Tauri 2 + Rust）
shared-types/   前后端共享类型
scripts/        构建、质量门禁与发布脚本
openspec/       OpenSpec 规格与变更管理
SKILLs/         项目级 Skills 定义
```

## License

- 项目许可证：[`MIT`](./LICENSE)
- 第三方来源与许可证说明：[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
