---
name: web-search
description: 使用 Playwright 进行网页搜索和内容提取
official: true
---

# Web Search Skill

当用户需要搜索实时信息、获取网页内容或进行网页截图时使用此 skill。

## 功能

1. **网页搜索** - 使用搜索引擎查找信息
2. **内容提取** - 提取网页文本内容
3. **网页截图** - 截取网页可视化内容

## 使用方法

### 搜索网页

```bash
bash "$SKILLS_ROOT/web-search/scripts/search.sh" "搜索关键词"
```

### 提取网页内容

```bash
bash "$SKILLS_ROOT/web-search/scripts/extract.sh" "https://example.com"
```

### 网页截图

```bash
bash "$SKILLS_ROOT/web-search/scripts/screenshot.sh" "https://example.com" "output.png"
```

## 环境要求

- Node.js 18+
- Playwright 已安装

## 安装依赖

```bash
cd "$SKILLS_ROOT/web-search" && npm install
```
