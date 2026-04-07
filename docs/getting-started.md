# Getting Started

本页面面向第一次接触 Arclay 的普通用户和非专业开发者，目标是在 5 到 10 分钟内完成：

1. 安装依赖
2. 启动应用
3. 配置模型 Provider
4. 跑通一次基本任务

## 1. 认识 Arclay

Arclay 是一个桌面优先的 AI 助手，核心流程是：

```text
Planning -> Approval -> Execution
```

生产形态是：

- Tauri 2 桌面应用
- React 前端
- Node.js API sidecar
- SQLite 本地数据存储

进一步阅读：

- [README.md](../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

## 2. 环境要求

- Node.js `>= 20`
- pnpm `>= 9`
- Rust stable
- Git

检查版本：

```bash
node -v
pnpm -v
rustc -V
git --version
```

## 3. 克隆并安装

```bash
git clone https://github.com/WhiteSnoopy/Arclay.git
cd Arclay
pnpm install
```

如果依赖安装失败，优先检查：

- Node / pnpm 版本是否满足要求
- Rust 工具链是否已安装
- 网络或 registry 访问是否正常

## 4. 启动应用

### 推荐：桌面模式

桌面模式最接近真实产品行为：

```bash
pnpm dev
```

这会启动：

- Tauri 桌面壳
- React 前端
- API sidecar

### Web 模式

如果你是在本地调试项目本身，可以使用 Web 模式：

```bash
pnpm dev:all
```

也可以拆开启动：

```bash
pnpm dev:web
pnpm dev:api
```

注意：

- 桌面模式使用 SQLite
- Web 模式使用 IndexedDB
- 两种模式数据不共享

## 5. 配置模型 Provider

首次启动后，需要在应用的 Settings 页面配置模型 Provider 和 API Key。

也可以直接编辑本地配置文件：

```text
~/.arclay/settings.json
```

当前支持的 Provider：

- `claude`
- `glm`
- `openai`
- `openrouter`
- `kimi`

如果没有配置 API Key，API sidecar 会启动，但 Agent 相关接口不会真正可用。

## 6. 跑通第一条任务

建议使用一个低风险任务做烟雾验证，例如：

- “帮我总结这个仓库的结构”
- “生成一个简单的 HTML 页面”
- “解释一下当前项目的双进程架构”

你会看到完整的三段流程：

1. Planning：生成计划
2. Approval：审批计划
3. Execution：执行并流式反馈

如果想验证更完整的桌面行为，优先在桌面模式下操作。

## 7. 常用命令

```bash
pnpm dev            # 启动桌面开发模式
pnpm dev:all        # 启动 Web + API
pnpm dev:web        # 仅启动前端
pnpm dev:api        # 仅启动 API
pnpm build          # 构建工作区
pnpm build:desktop  # 构建桌面应用
pnpm lint           # 代码检查
pnpm typecheck      # 类型检查
pnpm test           # 测试
pnpm test:e2e       # E2E 测试
```

## 8. 常见问题

### 端口被占用

```bash
./scripts/start.sh --clean
```

### 只想启动某一个服务

```bash
./scripts/start.sh --api-only
./scripts/start.sh --web-only
./scripts/start.sh --tauri
```

### 应用启动了，但 Agent 不能用

优先检查：

- Settings 中是否已配置 API Key
- `~/.arclay/settings.json` 是否存在有效 provider 配置
- API 服务是否正常

### 想了解开发规则

继续阅读：

- [development.md](./development.md)
- [testing.md](./testing.md)
- [deployment.md](./deployment.md)
- [AGENTS.md](../AGENTS.md)
