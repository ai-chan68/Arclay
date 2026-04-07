# Deployment Guide

本页描述 Arclay 当前的构建与发布方式。

Arclay 的唯一生产交付形态是桌面应用。

## 1. 发布产物

当前目标平台：

- macOS arm64
- macOS x64
- Windows x64
- Linux x64

最终产物由三部分协同组成：

- React 前端静态构建
- Node.js API sidecar 二进制
- Tauri 桌面包

## 2. 本地构建命令

### 构建工作区

```bash
pnpm build
```

### 构建 API sidecar

```bash
pnpm build:api
```

构建所有支持平台的 sidecar：

```bash
pnpm build:api:all
```

sidecar 构建脚本：

```text
scripts/build-api-binary.sh
```

它会：

1. 用 `esbuild` 打包 `apps/agent-service/src/index.ts`
2. 用 `@yao-pkg/pkg` 生成可执行文件
3. 输出到：

```text
apps/desktop/binaries/
```

### 构建桌面应用

```bash
pnpm build:desktop
```

这个命令会执行：

1. `pnpm build`
2. `pnpm build:api`
3. `pnpm tauri build`

## 3. 本地发布前检查

推荐先执行：

```bash
pnpm pre-release
```

当前包含：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm smoke:desktop:with-api`

然后再补：

```bash
pnpm test:e2e
pnpm build:desktop
```

如果改动风险较高，还建议：

```bash
pnpm dev
```

做一次真实桌面手动验证。

## 4. GitHub Actions 发布流程

主要工作流：

- `.github/workflows/quality-gates.yml`
- `.github/workflows/build.yml`

### `quality-gates.yml`

在 PR 和主分支变更时运行：

- lint
- typecheck
- test
- coverage
- smoke
- desktop e2e

### `build.yml`

触发条件：

- `workflow_dispatch`
- push 到 `main`
- push tag `v*.*.*`

流程分为三段：

1. `quality-gates`
2. `build-matrix`
3. `release`

## 5. 构建矩阵

`build-matrix` 会针对不同平台分别构建：

- `linux`
- `windows`
- `macos-intel`
- `macos-arm64`

每个平台都会执行：

1. 安装 Node / pnpm / Rust
2. 安装依赖
3. 构建前端
4. 构建 API sidecar
5. 构建桌面包
6. 准备 release 资产
7. 上传 artifacts

## 6. Release 资产准备

发布资产处理脚本：

```text
scripts/prepare-release-assets.mjs
scripts/write-build-metadata.mjs
```

作用包括：

- 生成目标平台构建元信息
- 整理 release 文件
- 生成校验信息

输出目录：

```text
dist/release/<target>/
```

## 7. 打标签发布

当前 GitHub Release job 会在 tag 满足以下模式时触发：

```text
v*.*.*
```

典型流程：

```bash
git tag v0.1.0
git push origin v0.1.0
```

随后 GitHub Actions 会：

1. 下载矩阵构建产物
2. 汇总 release assets
3. 创建或更新 GitHub Release

## 8. 平台依赖说明

### Linux

CI 中会安装：

- `libwebkit2gtk-4.1-dev`
- `libgtk-3-dev`
- `libayatana-appindicator3-dev`
- `librsvg2-dev`
- `patchelf`

本地 Linux 构建若失败，优先检查这些依赖。

### macOS / Windows

需要本机具备对应 Tauri / Rust 构建环境。

## 9. 发布前建议检查表

建议按以下顺序确认：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm smoke:desktop:with-api`
- `pnpm test:e2e`
- `pnpm build:desktop`

如果涉及：

- sidecar 打包
- Tauri 配置
- SQLite schema
- 本地文件系统行为

请额外做桌面模式人工验证。

## 10. 常见构建问题

### API sidecar 未生成

优先检查：

- `pnpm build:api` 是否成功
- `apps/desktop/binaries/` 下是否有产物

### 桌面构建失败

优先检查：

- Rust toolchain
- Tauri CLI
- 平台原生依赖
- sidecar 是否已正确生成

### CI 通过，本地失败

优先检查：

- Node / pnpm / Rust 版本
- 平台依赖差异
- 本地缓存或端口占用

## 11. 进一步阅读

- [getting-started.md](./getting-started.md)
- [development.md](./development.md)
- [testing.md](./testing.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
