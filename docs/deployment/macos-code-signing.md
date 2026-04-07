# macOS 代码签名配置指南

## 概述

Arclay 的 macOS DMG 打包已配置代码签名支持。要启用签名和公证，需要在 GitHub Actions 中配置以下 secrets。

## 必需的 GitHub Secrets

在仓库的 Settings → Secrets and variables → Actions 中添加：

### 1. APPLE_CERTIFICATE

开发者证书（.p12 格式）的 base64 编码。

**生成步骤：**

```bash
# 1. 从 Keychain Access 导出证书为 .p12 文件（包含私钥）
# 2. 转换为 base64
base64 -i certificate.p12 | pbcopy
# 3. 粘贴到 GitHub Secret
```

### 2. APPLE_CERTIFICATE_PASSWORD

导出 .p12 证书时设置的密码。

### 3. KEYCHAIN_PASSWORD

CI 构建时创建临时 keychain 的密码（任意强密码）。

### 4. APPLE_SIGNING_IDENTITY

证书的 Common Name，通常是：
- `Developer ID Application: Your Name (TEAM_ID)` （发布版）
- `Apple Development: Your Name (TEAM_ID)` （开发版）

可通过以下命令查看：

```bash
security find-identity -v -p codesigning
```

### 5. APPLE_ID

用于公证的 Apple ID 邮箱。

### 6. APPLE_PASSWORD

App-specific password（应用专用密码），不是 Apple ID 密码。

**生成步骤：**
1. 访问 https://appleid.apple.com/account/manage
2. 登录后进入 Security → App-Specific Passwords
3. 生成新密码并保存

### 7. APPLE_TEAM_ID

Apple Developer Team ID，可在 https://developer.apple.com/account 查看。

## 验证配置

配置完成后，推送代码到 main 分支或创建 tag，GitHub Actions 会自动：

1. 导入签名证书
2. 使用证书签名 .app 和 .dmg
3. 上传到 Apple 进行公证
4. 将公证后的 DMG 作为 release artifact

## 本地测试签名

```bash
# 检查签名
codesign -dv --verbose=4 /path/to/Arclay.app

# 验证公证
spctl -a -vv /path/to/Arclay.app
```

## 跳过签名（开发构建）

如果不配置上述 secrets，CI 会自动跳过签名步骤，生成未签名的 DMG（仅用于内部测试）。

## 参考文档

- [Tauri Code Signing](https://tauri.app/v1/guides/distribution/sign-macos)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
