# DMG 打包修复记录

## 修复日期
2026-04-07

## 问题清单与修复

### P0: 严重问题

#### 1. minimumSystemVersion 不正确
**问题**: 设置为 `10.13`（High Sierra），但 Tauri 2 实际需要 10.15+  
**修复**: 改为 `10.15`（Catalina）  
**文件**: `apps/desktop/tauri.conf.json`

#### 2. 缺少代码签名配置
**问题**: 未签名的 DMG 会被 macOS Gatekeeper 拦截，导致用户无法启动  
**修复**:
- 在 `tauri.conf.json` 添加 `signingIdentity` 等字段
- 在 CI workflow 添加证书导入和签名步骤
- 创建配置文档 `docs/deployment/macos-code-signing.md`

**文件**: 
- `apps/desktop/tauri.conf.json`
- `.github/workflows/build.yml`
- `docs/deployment/macos-code-signing.md`

### P1: 重要问题

#### 3. resources 捆绑全平台二进制
**问题**: `resources/claude-agent-sdk/vendor/ripgrep/` 包含 6 个平台的二进制，导致包体积膨胀  
**修复**: 
- 创建 `scripts/trim-resources-by-platform.mjs` 脚本
- 在 CI 构建前按目标平台裁剪非必需二进制
- 预计减少 DMG 体积约 30-40MB

**文件**:
- `scripts/trim-resources-by-platform.mjs` (新增)
- `.github/workflows/build.yml`

#### 4. shell 权限过宽
**问题**: `shell:allow-execute` 允许执行任意命令，存在安全风险  
**修复**: 移除 `shell:allow-execute`，仅保留白名单 `shell:allow-spawn` (arclay-api sidecar)

**文件**: `apps/desktop/capabilities/default.json`

### P2: 改进项

#### 5. CSP 完全关闭
**问题**: `csp: null` 无安全防护  
**修复**: 配置合理的 CSP 策略，限制 script-src、connect-src 等

**文件**: `apps/desktop/tauri.conf.json`

#### 6. 旧 sidecar 二进制残留
**问题**: `easywork-api-aarch64-apple-darwin` 旧文件未清理  
**修复**: 删除旧文件

**文件**: `apps/desktop/binaries/easywork-api-*` (已删除)

### P3: 用户体验优化

#### 7. DMG 窗口定制
**修复**: 添加 DMG 窗口大小和图标位置配置

**文件**: `apps/desktop/tauri.conf.json`

#### 8. 应用分类
**修复**: 添加 `category: "DeveloperTool"`，便于 macOS Finder 分类

**文件**: `apps/desktop/tauri.conf.json`

## 验证清单

- [x] 类型检查通过 (`pnpm typecheck`)
- [ ] 本地构建测试 (`pnpm build:desktop`)
- [ ] CI 构建测试（推送后验证）
- [ ] 代码签名测试（配置 secrets 后验证）
- [ ] DMG 安装测试（macOS 10.15+ 真机）

## 后续工作

1. **配置 GitHub Secrets** - 参考 `docs/deployment/macos-code-signing.md`
2. **添加自动更新** - 集成 Tauri updater 插件
3. **优化包体积** - 进一步分析 resources 目录，移除不必要的文件

## 预期效果

- ✅ DMG 可在 macOS 10.15+ 正常安装和启动
- ✅ 通过代码签名后，无 Gatekeeper 警告
- ✅ 包体积减少约 30-40MB
- ✅ 安全性提升（CSP + 权限收窄）
