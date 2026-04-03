# 🚀 EasyWork

<p align="center">
  <img src="./app-icon.png" alt="EasyWork Banner" width="100">
</p>

<p align="center">
  <a href="https://github.com/workany-ai/workany/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/workany-ai/workany" alt="License">
  </a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
</p>

> **EasyWork** 是一个基于 **Harness Engineering（装备工程）** 理念构建的专业 AI 开发者工作台。它通过确定的 `规划 -> 审批 -> 执行` 流程，将自然语言转化为 stable、可控的本地开发产出。

---

### 📺 场景演示 (Showcases)

| 任务场景 | 预览 |
| :--- | :--- |
| **自动化代码重构** | ![Refactor Demo](./docs/assets/refactor-demo.gif) |
| **环境初始化与配置** | ![Setup Demo](./docs/assets/setup-demo.gif) |

### ✨ 核心特性 (Key Features)

- 🛠️ **Harness 驱动**: Agent 是模型，Harness（工具、观测、权限）才是工程师编写的代码。
- 🔒 **原生沙箱 (Sandbox)**: 安全的本地命令执行，具备完善的错误恢复契约。
- 🏗️ **确定的执行流**: 拒绝黑盒，遵循 `Planning -> Approval -> Execution` 范式。
- 🧩 **动态扩展**: 深度集成 MCP (Model Context Protocol) 与 Skills 路由器。

### 🏗️ 技术架构 (Architecture)

<p align="center">
  <img src="./docs/assets/architecture-diagram.png" alt="Architecture" width="600">
</p>

EasyWork 采用三层架构确保跨平台稳定性与高性能：
- **Frontend**: React 19 + Vite + Tailwind CSS 4
- **API Service**: Hono + Node.js + Claude Agent SDK
- **Desktop Layer**: Tauri 2 + Rust + SQLite

### ⚡ 快速开始 (Quick Start)

#### 环境要求
- Node.js >= 20, pnpm >= 9, Git, Rust (Stable)

#### 安装运行
```bash
# 克隆仓库
git clone <repo-url> && cd EasyWork

# 安装依赖并启动
pnpm install && pnpm dev:all
```

| 命令 | 描述 |
| :--- | :--- |
| `pnpm dev:all` | 启动 Web 联调模式 (API + Frontend) |
| `pnpm build` | 全量构建项目 |
| `pnpm test` | 执行后端自动化测试 |

### ⚙️ 配置 (Configuration)

编辑 `~/.easywork/settings.json` 或在 UI 界面配置 `ANTHROPIC_API_KEY` 等环境变量。

### 🤝 贡献与许可

- [MIT License](./LICENSE)
- [English README](./README_EN.md)
