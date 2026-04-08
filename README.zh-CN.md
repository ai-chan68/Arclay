# 🚀 Arclay

<p align="center">
  <img src="./app-icon.png" alt="Arclay Logo" width="100">
</p>

<p align="center">
  <a href="https://github.com/WhiteSnoopy/Arclay/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/WhiteSnoopy/Arclay" alt="License">
  </a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
</p>

> **Arclay** 是一个面向普通用户的桌面 AI 助手。它通过可控的 `Planning → Approval → Execution` 工作流，把自然语言请求转化为文件、报告和本地任务结果，而不是黑盒式自动执行。

## 核心特性

- **自然语言发起任务**：直接用普通话描述你想完成的事情
- **先看计划，再执行**：执行前可以先确认系统准备做什么
- **桌面优先**：作为本地桌面应用运行，数据保存在本机
- **更可控的执行过程**：带有命令边界与运行时检查
- **需要时可扩展**：支持 MCP 与 Skills，但默认不要求用户理解这些技术概念

## 快速开始

### 环境要求

- Node.js `>= 20`
- pnpm `>= 9`
- Rust stable
- Git

### 安装与运行

```bash
git clone https://github.com/WhiteSnoopy/Arclay.git
cd Arclay
pnpm install
```

桌面开发模式：

```bash
pnpm dev
```

Web 开发模式：

```bash
pnpm dev:all
```

常用命令：

```bash
pnpm dev:web
pnpm dev:api
pnpm build
pnpm build:desktop
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm test:e2e
```

### 配置

在应用的 Settings 页面配置模型 Provider 和 API Key，或直接编辑：

```text
~/.arclay/settings.json
```

当前支持的 LLM Provider：

- `claude`
- `glm`
- `openai`
- `openrouter`
- `kimi`

## 项目文档

- [docs/getting-started.md](./docs/getting-started.md) - 快速上手
- [README.md](./README.md) - English overview
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 进阶架构说明

## 项目结构

```text
apps/
  web/            React 前端
  agent-service/  Node.js API Sidecar
  desktop/        Tauri / Rust 桌面壳
packages/
  shared-types/   共享类型
```

## 核心概念

### 引导式执行

1. **Planning**：生成 `TaskPlan`
2. **Approval**：用户审批计划
3. **Execution**：执行工具链并实时反馈

### 结果类型

- `static_files`
- `local_service`
- `deployed_service`
- `script_execution`
- `data_output`
- `unknown`

这些类型帮助系统判断应该生成静态文件、运行本地服务，还是返回一次性结果。

### 开发模式差异

- 桌面模式：真实生产栈，使用 SQLite
- Web 模式：用于快速迭代和 E2E，使用 IndexedDB

## 开发者说明

<details>
<summary>展开查看开发与测试细节</summary>

### 技术栈

- Desktop: Tauri 2 + Rust + SQLite
- UI: React 19 + Vite + Tailwind CSS 4 + React Router 7
- API: Hono + Node.js + Claude Agent SDK + Zod
- Monorepo: pnpm workspace

### 推荐开发路径

- 改前端：`pnpm dev:all`
- 改 API：`pnpm dev:api`
- 验证真实桌面行为：`pnpm dev`

### 提交前检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm build
```

### 进一步阅读

- 快速上手： [docs/getting-started.md](./docs/getting-started.md)
- 详细架构： [ARCHITECTURE.md](./ARCHITECTURE.md)
- 开发流程： [AGENTS.md](./AGENTS.md)
- 贡献规范： [CONTRIBUTING.md](./CONTRIBUTING.md)
- AI 协作规则： [CLAUDE.md](./CLAUDE.md)

</details>

## 许可证

[MIT License](./LICENSE)
