# EasyWork

EasyWork 是一个桌面优先的开源 AI 工作台，面向“真实执行”而不是“更长的聊天”。  
它把自然语言任务落成一个可规划、可审批、可执行、可恢复、可沉淀产物的完整流程。

你可以把它理解为一个面向“执行”的 AI 桌面环境：
- 先规划，再审批，再执行
- 支持多 Provider / Sandbox / Skills
- 支持任务历史、文件预览、定时任务与产物沉淀
- 面向本地工作目录与真实项目，而不是纯对话窗口

- English README：[`README_EN.md`](./README_EN.md)

## 为什么做这个项目

很多 AI 产品擅长回答问题，但不擅长把任务稳定地做完。  
EasyWork 关注的是另一件事：

- 如何让 AI 任务有明确阶段和状态
- 如何让用户在执行前看到计划并决定是否继续
- 如何把工具调用、审批、澄清、文件、结果都放进一个统一工作台
- 如何让任务可以回看、继续、恢复、调度，而不是一次性聊天结束

如果你也在做 Agent、桌面 AI、任务编排、审批流、工具调用或本地工作区集成，EasyWork 希望能成为一个可运行、可参考、可扩展的开源基础项目。

## 核心特性

- 两阶段执行主链路：`Planning -> Approval -> Execution`
- 支持澄清链路：当上下文不足时先提问，再继续规划
- 任务详情 workspace：左侧时间线、中心过程/结果、右侧文件预览
- 文件产物预览：代码、文档、图片、表格、HTML 等
- Provider / Sandbox 插件化：支持运行时切换与 fallback
- 审批与恢复：支持 `pending / approved / rejected / expired / canceled / orphaned`
- 定时任务：支持周期执行、超时、熔断与运行历史
- Skills 生态：来源管理、安装更新、健康检查、路由模式
- Appearance：支持 `Light / Dark / System`

## 适合谁

- 想把 LLM 从聊天窗口带进真实工作流的开发者
- 需要“先计划、再审批、后执行”的 Agent 产品团队
- 想研究本地桌面 AI、Tauri、任务恢复与产物预览的开源贡献者
- 想在一个可运行项目上继续扩展 Provider、Sandbox、Skills 或调度能力的社区成员

## 当前架构

EasyWork 采用桌面优先的三层结构：

1. 前端层 `src/`
React + React Router + Vite + Tailwind  
负责任务交互、状态展示、SSE 消费、任务详情工作台、文件预览与设置页面。

2. 后端层 `src-api/`
Hono + Agent Runtime  
负责规划/执行编排、审批协调、Provider/Sandbox 管理、Skills 路由与调度。

3. 桌面层 `src-tauri/`
Tauri 2 + Rust  
负责 sidecar 生命周期、桌面能力桥接、本地数据库与桌面打包。

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
cd easeWork

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

运行时设置默认保存在：

- `~/.easywork/settings.json`
- `~/.easywork/plans.json`
- `~/.easywork/approval-requests.json`
- `~/.easywork/scheduled-tasks.json`

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
src-api/        后端（Hono + Agent Runtime）
src-tauri/      桌面壳（Tauri 2 + Rust）
shared-types/   前后端共享类型
scripts/        构建、质量门禁与发布脚本
openspec/       OpenSpec 规格与变更管理
SKILLs/         项目级 Skills 定义
```

## API 概览

主要接口：

- 健康检查：`/api/health`、`/api/health/dependencies`
- 两阶段执行：`/api/v2/agent/plan`、`/api/v2/agent/execute`
- 兼容直执行：`/api/v2/agent`
- 执行控制：`/api/v2/agent/stop/:id`
- 审批回传：`/api/v2/agent/permission`、`/api/v2/agent/question`
- 定时任务：`/api/scheduled-tasks/*`
- 设置与 Provider：`/api/settings/*`、`/api/providers`
- 文件与预览：`/api/files/*`、`/api/preview/*`

> 说明：旧的 `/api/agent/*` 已 sunset，只保留迁移提示。

## Open Source 工作方式

这个项目使用 **OpenSpec** 管理需求、设计和任务拆解。

- 活跃规格：[`openspec/specs/`](./openspec/specs/)
- 已归档变更：[`openspec/changes/archive/`](./openspec/changes/archive/)

如果你准备贡献较大的功能或改动，建议先：

1. 明确需求范围
2. 创建或补充 OpenSpec change
3. 再进入实现

这样可以避免 UI、交互和运行时行为在没有设计上下文的情况下漂移。

## Roadmap

当前重点方向包括：

- 更完整的多 Agent 前端闭环
- 更强的跨重启恢复与运行态持久化
- 更清晰的执行可观测性、错误分层与运行报告
- 更成熟的 Skills 路由反馈与调试体验
- 更稳定的开源贡献流程、文档和样例配置

## 贡献方式

欢迎 Issue、讨论和 PR。

建议的贡献流程：

1. Fork / Clone 项目
2. 安装依赖并本地跑通
3. 对较大改动先补 OpenSpec proposal / design / tasks
4. 完成实现后运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

5. 提交 PR，并说明：
- 改了什么
- 为什么改
- 如何验证
- 是否涉及 OpenSpec 变更

如果你想低门槛参与，也很欢迎从这些方向开始：

- 补文档或示例配置
- 改善错误提示和空状态
- 增加测试和回归用例
- 新增或整理 Skills / Provider 集成

## 当前状态

EasyWork 仍在快速迭代中，目前比较稳定的是：

- 两阶段执行主链路
- 任务详情 workspace
- Provider / Sandbox 插件化底座
- 定时任务与审批恢复能力

仍在持续完善的方向包括：

- 多 Agent 前端闭环体验
- 更强的跨重启恢复能力
- 更完整的可观测性与运行报告
- 更成熟的 Skills 路由反馈机制

## 开源说明

EasyWork 的目标是成为一个长期维护的开源项目。

- 核心代码默认按 MIT 许可证开放
- 运行时密钥、Provider 配置与本地状态仍然保存在用户本机
- 部分能力仍在快速演进中，接口和交互会继续迭代
- 欢迎通过 Issue、PR 和讨论一起完善路线图与实现细节

## License

- 项目许可证：[`MIT`](./LICENSE)
- 第三方来源与许可证说明：[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
