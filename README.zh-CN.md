<div align="center">

# 🚀 Arclay

**透明可控的桌面 AI 助手**

通过可控工作流将自然语言转化为可靠的本地自动化

[![License](https://img.shields.io/github/license/WhiteSnoopy/Arclay)](https://github.com/WhiteSnoopy/Arclay/blob/main/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB?logo=tauri)](https://tauri.app)

[简体中文](#) | [English](./README.md)

<img src="./app-icon.png" alt="Arclay Logo" width="120">

</div>

---

## 🎯 Arclay 是什么？

Arclay 是一个**桌面优先的 AI 助手**，通过**透明、可控的工作流**，将你的自然语言请求转化为可执行的结果——文件、报告、本地服务。

与黑盒式 AI 工具不同，Arclay 在执行前会向你展示计划，让你完全掌控机器上发生的一切。

### ✨ 核心亮点

```
📝 自然语言输入  →  🤖 AI 规划  →  ✅ 你的审批  →  ⚡ 安全执行
```

- **🗣️ 自然表达** - 用日常语言描述任务，无需技术术语
- **👀 先看后做** - 执行前查看完整计划
- **🔒 本地私密** - 桌面应用，数据保存在本机，无云端依赖
- **🛡️ 可控执行** - 运行时检查和沙箱边界保护你的系统
- **🔧 可扩展** - 支持 MCP 和 Skills（高级用户可选）

---

## 🚀 快速开始

### 📋 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| **Node.js** | `>= 20` | API 服务运行时 |
| **pnpm** | `>= 9` | 包管理器 |
| **Rust** | stable | 桌面应用编译 |
| **Git** | latest | 版本控制 |

### ⚡ 安装

```bash
# 克隆仓库
git clone https://github.com/WhiteSnoopy/Arclay.git
cd Arclay

# 安装依赖
pnpm install
```

### 🎮 运行应用

**桌面模式**（推荐 - 生产环境栈）
```bash
pnpm dev
```

**Web 模式**（仅用于开发 - 快速迭代）
```bash
pnpm dev:all
```

### ⚙️ 配置

在应用的 **Settings** 页面配置 LLM 供应商，或手动编辑：

```bash
~/.arclay/settings.json
```

**支持的供应商：**

Arclay 使用 **Claude Agent SDK**，这意味着任何支持 **Anthropic API 格式**的供应商都可以接入。

| 供应商 | 需要的 API Key | 兼容性 | 说明 |
|----------|---------------|--------|------|
| Claude | `ANTHROPIC_API_KEY` | ✅ 原生支持 | 推荐使用，官方支持 |
| GLM | `GLM_API_KEY` | ✅ 兼容 | 国内市场，智谱 AI |
| Kimi | `KIMI_API_KEY` | ✅ 兼容 | 国内市场，月之暗面 |
| DeepSeek | `DEEPSEEK_API_KEY` | ✅ 兼容 | 国内市场 |
| OpenRouter | `OPENROUTER_API_KEY` | ✅ 兼容 | 多模型网关 |

> **注意：** 任何实现了 Anthropic API 格式（Messages API、tool use、streaming）的 LLM 供应商都可以在 Arclay 中使用。

---

## 🏗️ 架构概览

Arclay 是一个基于现代 Web 技术构建的**双进程桌面应用**：

```
┌─────────────────────────────────────────┐
│  Arclay 桌面应用                         │
│                                         │
│  ┌─────────────┐      ┌──────────────┐ │
│  │  React UI   │ ←──→ │ Tauri 壳     │ │
│  │  (WebView)  │      │   (Rust)     │ │
│  └──────┬──────┘      └──────────────┘ │
│         │ HTTP/SSE                      │
│  ┌──────▼──────────────────────────┐   │
│  │  API Sidecar (Node.js)          │   │
│  │  • Agent 编排                   │   │
│  │  • 工具执行                     │   │
│  │  • MCP & Skills 集成            │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 📦 项目结构

```
apps/
├── web/              # React 19 + Vite 前端
├── agent-service/    # Hono + Node.js API Sidecar
└── desktop/          # Tauri 2 + Rust 桌面壳

packages/
└── shared-types/     # 共享 TypeScript 类型
```

### 🔄 工作原理

**三阶段工作流：**

1. **📝 规划阶段**
   - AI 分析你的请求
   - 生成详细的 `TaskPlan`
   - 分类可交付物类型（文件、服务、数据等）

2. **✅ 审批阶段**
   - 你审查计划
   - 批准、拒绝或请求澄清
   - 执行前完全透明

3. **⚡ 执行阶段**
   - 沙箱中的受控工具执行
   - 实时流式反馈
   - 运行时验证和健康检查

**可交付物类型：**

| 类型 | 描述 | 运行时验证 |
|------|------|-----------|
| `static_files` | HTML、CSS、文档 | 宽松 |
| `local_service` | 开发服务器、API | 严格健康检查 |
| `deployed_service` | 云部署 | 严格健康检查 |
| `script_execution` | 一次性脚本 | 宽松 |
| `data_output` | 报告、分析 | 宽松 |

---

## 📚 项目文档

| 文档 | 说明 |
|------|------|
| [🇺🇸 English](./README.md) | 英文版 README |
| [🏛️ 架构文档](./ARCHITECTURE.md) | 详细技术架构 |
| [🤝 贡献指南](./CONTRIBUTING.md) | 如何为 Arclay 贡献代码 |
| [👨‍💻 开发者指南](./AGENTS.md) | 分步开发工作流 |
| [🤖 AI 协作](./CLAUDE.md) | AI 辅助开发规则 |

---

## 🛠️ 开发指南

<details>
<summary><b>点击展开开发指南</b></summary>

### 技术栈

| 层级 | 技术 |
|------|------|
| **桌面** | Tauri 2, Rust, SQLite |
| **前端** | React 19, Vite, Tailwind CSS 4, React Router 7 |
| **API** | Hono, Node.js, Claude Agent SDK, Zod |
| **Monorepo** | pnpm workspace |

### 开发工作流

```bash
# 前端开发（热重载）
pnpm dev:all

# API 开发（独立运行）
pnpm dev:api

# 桌面模式（生产环境栈）
pnpm dev

# 运行测试
pnpm test                # 单元测试
pnpm test:coverage       # 覆盖率报告
pnpm test:e2e            # E2E 测试

# 质量检查
pnpm typecheck           # TypeScript
pnpm lint                # ESLint

# 构建
pnpm build               # 所有包
pnpm build:desktop       # 桌面应用
```

### 提交前检查清单

提交 PR 前，确保：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过且覆盖率 ≥80%
- [ ] `pnpm test:e2e` 通过
- [ ] `pnpm build` 成功
- [ ] 桌面模式手动测试通过

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev:web` | 仅启动前端 |
| `pnpm dev:api` | 仅启动 API |
| `pnpm build:api` | 构建 API 二进制 |
| `pnpm build:api:all` | 为所有平台构建 |
| `./scripts/start.sh --clean` | 清理端口并启动 |

</details>

---

## 🤝 参与贡献

我们欢迎贡献！请阅读我们的[贡献指南](./CONTRIBUTING.md)开始。

**快速链接：**
- [报告 Bug](https://github.com/WhiteSnoopy/Arclay/issues/new?labels=bug)
- [请求功能](https://github.com/WhiteSnoopy/Arclay/issues/new?labels=enhancement)
- [提问讨论](https://github.com/WhiteSnoopy/Arclay/discussions)

---

## 📄 许可证

本项目采用 [MIT License](./LICENSE) 开源。

---

<div align="center">

**用 ❤️ 构建，基于 Tauri、React 和 Claude Agent SDK**

[⭐ 在 GitHub 上给我们 Star](https://github.com/WhiteSnoopy/Arclay) | [📖 阅读文档](./ARCHITECTURE.md) | [💬 加入讨论](https://github.com/WhiteSnoopy/Arclay/discussions)

</div>
