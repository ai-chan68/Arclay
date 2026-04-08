#!/bin/bash

# Arclay 项目清理脚本
# 删除开发过程中产生的临时文件和构建产物

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 Arclay 项目清理"
echo "===================="
echo ""

# 函数：安全删除目录
safe_remove() {
  local path="$1"
  local desc="$2"

  if [ -d "$path" ]; then
    local size=$(du -sh "$path" 2>/dev/null | cut -f1)
    echo "🗑️  删除 $desc ($size)"
    rm -rf "$path"
    echo "   ✓ 已删除: $path"
  else
    echo "⊘  跳过 $desc (不存在)"
  fi
}

echo "清理临时文件和构建产物..."
echo ""

# 1. 删除日志文件
safe_remove "$ROOT_DIR/logs" "开发日志"

# 2. 删除 Git worktrees
safe_remove "$ROOT_DIR/.worktrees" "Git worktrees"

# 3. 删除运行时工作区
safe_remove "$ROOT_DIR/apps/agent-service/workspace" "Agent 工作区"

# 4. 删除测试覆盖率报告
safe_remove "$ROOT_DIR/apps/agent-service/coverage" "测试覆盖率报告"

# 5. 删除未跟踪的 website 目录
safe_remove "$ROOT_DIR/website" "Website 静态文件"

# 6. 删除构建产物
safe_remove "$ROOT_DIR/dist" "根目录构建产物"

# 7. 删除 .DS_Store 文件
echo ""
echo "🗑️  删除 .DS_Store 文件"
find "$ROOT_DIR" -name ".DS_Store" -type f -delete 2>/dev/null || true
echo "   ✓ 已删除所有 .DS_Store 文件"

echo ""
echo "✅ 清理完成！"
echo ""
echo "💡 提示："
echo "   - 这些文件会在开发过程中重新生成"
echo "   - 它们已在 .gitignore 中，不会被提交到 Git"
echo "   - 如需重新构建，运行: pnpm build"
