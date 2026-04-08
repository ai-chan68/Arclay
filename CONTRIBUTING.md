# CONTRIBUTING.md

本仓库欢迎 Issue、Discussion 和 Pull Request。

Arclay 是一个桌面优先的 AI 开发工作台，生产形态为 Tauri 桌面应用。贡献代码前，建议先读完以下文档：

- [README.md](./README.md) - 项目概览与常用命令
- [AGENTS.md](./AGENTS.md) - 可复制执行的开发流程
- [CLAUDE.md](./CLAUDE.md) - AI 协作规则与架构概览
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 详细架构说明
- [.claude/rules/](./.claude/rules/) - 开发、测试、Git、安全规则

## 1. 环境要求

- Node.js `>= 20`
- pnpm `>= 9`
- Rust stable
- Git
- macOS / Linux / Windows 均可开发，桌面验证需本机具备 Tauri 运行环境

安装依赖：

```bash
pnpm install
```

## 2. 项目结构

```text
apps/
  web/            React 前端
  agent-service/  Node.js API Sidecar
  desktop/        Tauri / Rust 桌面壳
packages/
  shared-types/   前后端共享类型
```

核心原则：

- `apps/web` 负责 UI 与本地数据库访问
- `apps/agent-service` 负责 Agent harness、SSE、Skills、MCP、Sandbox
- `apps/desktop` 负责 Tauri 壳、sidecar 拉起、SQLite 初始化

## 3. 开发模式

### 桌面模式

用于验证真实生产行为：

```bash
pnpm dev
```

### Web 模式

用于前后端快速迭代和 E2E：

```bash
pnpm dev:all
```

可单独启动：

```bash
pnpm dev:web
pnpm dev:api
```

注意：

- Web 模式使用 IndexedDB
- 桌面模式使用 SQLite
- 两者数据不共享

## 4. 开发工作流

贡献新功能或修复问题时，遵循以下顺序：

1. 先研究现有实现与复用机会
2. 先写计划，再动代码
3. 采用 TDD：`RED -> GREEN -> REFACTOR`
4. 完成后做代码审查
5. 最后再提交 commit / PR

更详细的可执行步骤见 [AGENTS.md](./AGENTS.md)。

## 5. 编码规范

### 通用要求

- 保持高内聚、低耦合
- 优先小文件，避免超大模块
- 共享类型放在 `packages/shared-types`
- 优先复用已有服务、路由、store、工具注册机制

### TypeScript / React

- 使用严格类型
- 不要随意绕过类型系统
- 保持不可变更新，避免直接 mutation
- 前端代码优先沿用现有 hooks、shared lib、组件结构

### Rust / Tauri

- 桌面层只承载壳能力，不承载复杂业务编排
- 新增桌面能力前，先确认是否应放在 sidecar 层

### Harness Engineering

本项目遵循 Harness Engineering：

- Agent 是模型，不是业务逻辑代码
- 工程代码负责工具、权限、观测、恢复契约
- 不要用硬编码流程去替代模型决策

## 6. 测试要求

最低要求：

- 测试覆盖率 `>= 80%`
- 单元测试、集成测试、E2E 测试都要覆盖关键路径

常用命令：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm test:e2e:integration
pnpm build
```

按模块执行：

```bash
cd apps/agent-service
pnpm exec vitest run src/path/to/file.test.ts
```

TDD 期望流程：

1. 先写失败测试
2. 确认测试先失败
3. 写最小实现让测试通过
4. 重构并保持通过
5. 补充覆盖率验证

## 7. 提交前检查

提交 PR 前至少完成：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm test:e2e`
- `pnpm build`

如果改动涉及桌面行为，还应在桌面模式下验证：

```bash
pnpm dev
```

如果改动只涉及局部模块，也请在 PR 中明确说明你实际运行了哪些验证、哪些没有运行，以及原因。

## 8. 安全要求

禁止：

- 提交真实 API Key、Token、Cookie、私钥
- 绕过输入校验
- 把敏感信息写入日志或错误信息
- 引入明显的 SQL 注入、XSS、路径穿越风险

提交前请自查：

- 无硬编码密钥
- 输入经过验证
- 错误信息不泄漏敏感内容
- 新增命令执行路径具备明确边界

## 9. 文档要求

以下变更通常需要同步更新文档：

- 新增或调整架构边界：更新 [ARCHITECTURE.md](./ARCHITECTURE.md)
- 新增开发流程：更新 [AGENTS.md](./AGENTS.md)
- 新增用户可见能力或命令：更新 [README.md](./README.md)
- 新增贡献规范或流程：更新本文件

## 10. Commit 规范

提交信息格式：

```text
<type>: <description>
```

常用类型：

- `feat`
- `fix`
- `refactor`
- `docs`
- `test`
- `chore`
- `perf`
- `ci`

示例：

```text
docs: add contributing guide and pull request template
fix: correct runtime gate classification for static html tasks
```

## 11. Pull Request 要求

PR 应包含：

- 变更背景
- 主要修改点
- 风险与兼容性影响
- 测试计划
- 如有 UI 变化，附截图或录屏

请使用仓库提供的 PR 模板。

## 12. 适合首次贡献的方向

如果你第一次参与本项目，建议从以下方向开始：

- 文档修正或补充
- 单元测试补齐
- 小范围前端交互优化
- 配置与脚本改进
- 低风险 bugfix

## 13. 需要帮助时

如果你不确定改动应该放在哪一层：

- UI / 本地数据展示：优先看 `apps/web`
- Agent 编排 / API / SSE / Skills / MCP / Sandbox：优先看 `apps/agent-service`
- 桌面能力 / sidecar / SQLite 初始化：优先看 `apps/desktop`

如果你不确定工作流，先看 [AGENTS.md](./AGENTS.md)。
