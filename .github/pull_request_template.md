## Summary

说明这次改动解决了什么问题，以及为什么要改。

## Changes

- [ ] 列出主要改动 1
- [ ] 列出主要改动 2
- [ ] 列出主要改动 3

## Scope

- [ ] `apps/web`
- [ ] `apps/agent-service`
- [ ] `apps/desktop`
- [ ] `packages/shared-types`
- [ ] `docs`
- [ ] `scripts`

## Architecture / Compatibility Impact

说明是否影响以下内容：

- 双进程架构
- HTTP / SSE / Tauri IPC
- SQLite schema / 本地存储
- Skills / MCP / Sandbox
- 计划 / 审批 / 执行链路

若无影响，请写 `None`。

## Test Plan

实际运行过的命令：

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:coverage`
- [ ] `pnpm test:e2e`
- [ ] `pnpm test:e2e:integration`
- [ ] `pnpm build`
- [ ] `pnpm dev` 手动桌面验证

补充说明：

```text
写明运行结果、未执行项及原因
```

## UI / UX Evidence

- [ ] 无 UI 变化
- [ ] 已附截图
- [ ] 已附录屏

## Checklist

- [ ] 已阅读 `AGENTS.md`
- [ ] 已自查安全风险
- [ ] 已同步更新相关文档
- [ ] 已确认无硬编码密钥或敏感信息
- [ ] 已按 Conventional Commit 风格整理提交历史
