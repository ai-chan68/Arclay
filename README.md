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
- 支持意图感知执行：可区分信息获取、交互操作与混合型网页任务
- 支持策略化执行：按任务类型选择文本提取、浏览器自动化、截图与结构化读取方式
- 任务详情 workspace：左侧时间线、中心过程/结果、右侧文件预览
- 文件产物预览：代码、文档、图片、表格、HTML 等
- Provider / Sandbox 插件化：支持运行时切换与 fallback
- 审批与恢复：支持计划审批、等待用户、执行中断、失败恢复与跨重启回看
- 执行可观测性：支持 Provider 完成元信息、浏览器动作统计与执行过程审计
- 定时任务：支持周期执行、超时、熔断与运行历史
- Skills 生态：来源管理、安装更新、健康检查、路由模式
- Appearance：支持 `Light / Dark / System`

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

运行时设置默认保存在：

- `~/.easywork/settings.json`
- `~/.easywork/plans.json`
- `~/.easywork/approval-requests.json`
- `~/.easywork/scheduled-tasks.json`
- `~/.easywork/turn-runtime.json`

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

## License

- 项目许可证：[`MIT`](./LICENSE)
- 第三方来源与许可证说明：[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
