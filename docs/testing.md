# Testing Guide

本页汇总 Arclay 当前的测试层次、常用命令和排查方式。

## 1. 测试目标

提交前至少覆盖以下检查：

- `lint`
- `typecheck`
- 单元测试
- 覆盖率
- E2E
- 构建验证

最低要求：

- 测试覆盖率 `>= 80%`

参考规则：

- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [AGENTS.md](../AGENTS.md)
- [.claude/rules/testing.md](../.claude/rules/testing.md)

## 2. 命令总览

根目录常用命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm test:e2e:integration
pnpm build
pnpm smoke:desktop
pnpm smoke:desktop:with-api
pnpm pre-release
```

## 3. 包级测试行为

### `apps/web`

- `lint`: `tsc --noEmit`
- `typecheck`: `tsc --noEmit`
- `test`: 当前没有单元测试，脚本会显式打印 skip

### `apps/agent-service`

- `lint`: `tsc --noEmit`
- `typecheck`: `tsc --noEmit`
- `test`: `vitest run`
- `test:coverage`: `vitest run --coverage`

### `packages/shared-types`

- `lint`: `tsc --noEmit`
- `typecheck`: `tsc --noEmit`
- `test`: 当前没有单元测试，脚本会显式打印 skip

## 4. `quality-runner` 机制

根目录的 `lint` / `typecheck` / `test` 命令并不是单个包内命令，而是通过：

```text
scripts/quality-runner.mjs
```

依次检查指定包是否存在对应脚本，然后顺序执行。

例如：

```bash
pnpm test
```

实际会检查并运行：

- `apps/web`
- `apps/agent-service`
- `packages/shared-types`

这意味着：

- 某个包缺少对应脚本会直接失败
- 所有包的脚本命名需要保持一致

## 5. 单元测试与覆盖率

Agent 侧单元测试位于：

```text
apps/agent-service/src/**/*.test.ts
```

运行所有单元测试：

```bash
pnpm test
```

运行覆盖率：

```bash
pnpm test:coverage
```

只跑单个文件：

```bash
cd apps/agent-service
pnpm exec vitest run src/services/__tests__/agent-service.test.ts
```

watch 模式：

```bash
cd apps/agent-service
pnpm exec vitest
```

## 6. E2E 测试

E2E 相关文件位于：

```text
e2e/
```

### Mock E2E

```bash
pnpm test:e2e
```

用途：

- 快速验证前端流程
- 使用 mock API server
- 适合回归 UI 和状态流

### Integration E2E

```bash
pnpm test:e2e:integration
```

用途：

- 真实 API + Fake Provider
- 验证更完整的前后端链路

更多说明见：

- [e2e/README.md](../e2e/README.md)
- [e2e/PHASE_STABILITY_TESTING.md](../e2e/PHASE_STABILITY_TESTING.md)
- [e2e/COMPLEX_TASKS_TESTING.md](../e2e/COMPLEX_TASKS_TESTING.md)

## 7. Smoke 测试

### 已有 API 时执行 smoke

```bash
pnpm smoke:desktop
```

默认检查：

- `/api/health`
- `/api/settings`
- `/api/preview/list`
- `/api/settings/skills/list`
- `/api/v2/agent/plan` 路由可达性

### 自动拉起 API 再做 smoke

```bash
pnpm smoke:desktop:with-api
```

这个命令会：

1. 启动 `pnpm dev:api`
2. 等待 `/api/health` 就绪
3. 运行 smoke 检查
4. 结束后关闭 API 进程

质量门禁和 CI 都依赖这一条。

## 8. 构建验证

运行整体构建：

```bash
pnpm build
```

构建桌面包：

```bash
pnpm build:desktop
```

构建 sidecar：

```bash
pnpm build:api
pnpm build:api:all
```

如果改动影响桌面行为，建议补充：

```bash
pnpm dev
```

做一次真实桌面验证。

## 9. 发布前验证

快速跑一轮发布前门禁：

```bash
pnpm pre-release
```

当前包含：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm smoke:desktop:with-api`

注意：

- 它不是完整发布流程
- 也不会代替 `pnpm test:e2e`

## 10. CI 中运行的门禁

GitHub Actions 中：

- `.github/workflows/quality-gates.yml`
- `.github/workflows/build.yml`

质量门禁会执行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm smoke:desktop:with-api`
- `pnpm test:e2e`

## 11. 常见问题排查

### 端口占用

```bash
./scripts/start.sh --clean
```

### E2E 启动失败

优先检查：

- `localhost:1420` 是否被占用
- `localhost:2026` 是否被占用
- Playwright 浏览器是否已安装

安装 Playwright 浏览器：

```bash
npx playwright install --with-deps chromium
```

### 只想调试某个 E2E 文件

```bash
pnpm exec playwright test e2e/tests/task-lifecycle.spec.ts
```

### 需要交互式调试

```bash
pnpm exec playwright test --debug
```

## 12. 推荐测试顺序

对于普通代码改动，推荐顺序：

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm test:coverage`
5. `pnpm test:e2e`
6. `pnpm build`

对于桌面和发布相关改动，再补：

1. `pnpm smoke:desktop:with-api`
2. `pnpm dev`
3. `pnpm build:desktop`
