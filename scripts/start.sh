#!/bin/bash

# ===========================================
# EasyWork 一键启动脚本
# 自动检测并清理端口占用，然后启动服务
# ===========================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 端口配置
API_PORT=${PORT:-2026}
FRONTEND_PORT=${FRONTEND_PORT:-1420}

# 日志目录
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

setup_log_dir() {
    mkdir -p "$LOG_DIR"
    # 日志文件以启动时间命名，方便区分每次运行
    LOG_TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    API_LOG="$LOG_DIR/api_${LOG_TIMESTAMP}.log"
    FRONTEND_LOG="$LOG_DIR/frontend_${LOG_TIMESTAMP}.log"
    TAURI_LOG="$LOG_DIR/tauri_${LOG_TIMESTAMP}.log"
    log_info "日志目录: $LOG_DIR"
}

# 打印带颜色的消息
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检测操作系统
OS="$(uname -s)"
case "$OS" in
    Darwin*)    OS_TYPE="macos" ;;
    Linux*)     OS_TYPE="linux" ;;
    CYGWIN*|MINGW*|MSYS*)    OS_TYPE="windows" ;;
    *)          OS_TYPE="unknown" ;;
esac

log_info "检测到操作系统: $OS_TYPE"

# 杀掉占用指定端口的进程
kill_port() {
    local port=$1
    local pids=""

    case "$OS_TYPE" in
        macos|linux)
            pids=$(lsof -ti:$port 2>/dev/null || true)
            ;;
        windows)
            pids=$(netstat -ano | grep ":$port " | awk '{print $5}' | sort -u || true)
            ;;
    esac

    if [ -n "$pids" ]; then
        log_warning "端口 $port 被占用，正在清理..."
        for pid in $pids; do
            if [ -n "$pid" ]; then
                log_info "终止进程 PID: $pid (端口 $port)"
                kill -9 $pid 2>/dev/null || true
            fi
        done
        sleep 1
        log_success "端口 $port 已释放"
    else
        log_info "端口 $port 可用"
    fi
}

# 等待端口可用
wait_for_port() {
    local port=$1
    local max_wait=10
    local count=0

    while [ $count -lt $max_wait ]; do
        if ! lsof -i:$port >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    return 1
}

# 清理函数
cleanup() {
    log_info "正在停止服务..."
    if [ ! -z "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$TAURI_PID" ]; then
        kill $TAURI_PID 2>/dev/null || true
    fi
    log_success "服务已停止"
    exit 0
}

# 捕获退出信号
trap cleanup SIGINT SIGTERM

# 显示 Banner
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        EasyWork 启动脚本               ║${NC}"
echo -e "${GREEN}║    Multi-Agent 协作工具                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# 解析参数
MODE="all"
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-only)
            MODE="api"
            shift
            ;;
        --web-only)
            MODE="web"
            shift
            ;;
        --tauri)
            MODE="tauri"
            shift
            ;;
        --web-desktop)
            MODE="web-desktop"
            shift
            ;;
        --clean)
            log_info "仅清理端口..."
            kill_port $API_PORT
            kill_port $FRONTEND_PORT
            log_success "端口清理完成"
            exit 0
            ;;
        -h|--help)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --api-only    仅启动 API 服务器"
            echo "  --web-only    仅启动 Web 前端"
            echo "  --tauri       启动 Tauri 桌面应用"
            echo "  --web-desktop 一键启动 Web + 桌面端 (含 API)"
            echo "  --clean       仅清理端口，不启动服务"
            echo "  -h, --help    显示帮助信息"
            echo ""
            echo "示例:"
            echo "  $0              # 启动所有服务 (API + Web)"
            echo "  $0 --api-only   # 仅启动 API 服务器"
            echo "  $0 --tauri      # 启动 Tauri 桌面应用"
            echo "  $0 --web-desktop # 启动 Web + 桌面端"
            echo "  $0 --clean      # 清理端口"
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            exit 1
            ;;
    esac
done

# 步骤 1: 清理端口
log_info "步骤 1/3: 检查并清理端口..."
kill_port $API_PORT
if [ "$MODE" = "all" ] || [ "$MODE" = "web" ] || [ "$MODE" = "tauri" ] || [ "$MODE" = "web-desktop" ]; then
    kill_port $FRONTEND_PORT
fi

# 步骤 2: 检查依赖
log_info "步骤 2/3: 检查依赖..."
if ! command -v pnpm &> /dev/null; then
    log_error "pnpm 未安装，请先安装: npm install -g pnpm"
    exit 1
fi
log_success "依赖检查通过"

# 步骤 3: 启动服务
log_info "步骤 3/3: 启动服务..."
setup_log_dir

case "$MODE" in
    "api")
        log_info "启动 API 服务器 (端口 $API_PORT)..."
        log_info "日志文件: $API_LOG"
        cd "$(dirname "$0")/.."
        pnpm --filter src-api dev 2>&1 | tee "$API_LOG"
        ;;

    "web")
        log_info "启动 Web 前端 (端口 $FRONTEND_PORT)..."
        log_info "日志文件: $FRONTEND_LOG"
        cd "$(dirname "$0")/.."
        pnpm --filter src dev 2>&1 | tee "$FRONTEND_LOG"
        ;;

    "tauri")
        log_info "启动 Tauri 桌面应用..."
        log_info "日志文件: $TAURI_LOG"
        cd "$(dirname "$0")/.."
        pnpm tauri dev 2>&1 | tee "$TAURI_LOG"
        ;;

    "web-desktop")
        log_info "一键启动 Web + 桌面端 (含 API)..."
        cd "$(dirname "$0")/.."
        log_info "日志文件: $TAURI_LOG"
        pnpm tauri dev >> "$TAURI_LOG" 2>&1 &
        TAURI_PID=$!

        sleep 5
        if ! kill -0 $TAURI_PID 2>/dev/null; then
            wait $TAURI_PID || true
            log_error "Tauri 启动失败，请检查上方日志"
            exit 1
        fi

        if curl -s "http://localhost:$API_PORT/api/settings" > /dev/null 2>&1; then
            log_success "API 服务器已启动: http://localhost:$API_PORT"
        else
            log_warning "API 服务器可能还在启动中..."
        fi

        if curl -s "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
            log_success "Web 前端已启动: http://localhost:$FRONTEND_PORT"
        else
            log_warning "Web 前端可能还在启动中..."
        fi

        log_success "Web + 桌面端运行中"
        echo ""
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo -e "  API 服务器:  ${BLUE}http://localhost:$API_PORT${NC}"
        echo -e "  Web 前端:    ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
        echo -e "  桌面端:      ${BLUE}Tauri Dev Window${NC}"
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo ""
        echo "按 Ctrl+C 停止所有服务"
        echo ""

        wait $TAURI_PID
        ;;

    "all")
        log_info "启动 API 服务器 (端口 $API_PORT)..."
        log_info "API 日志: $API_LOG"
        cd "$(dirname "$0")/.."
        pnpm --filter src-api dev >> "$API_LOG" 2>&1 &
        API_PID=$!

        # 等待 API 启动
        sleep 3

        # 检查 API 是否启动成功
        if curl -s "http://localhost:$API_PORT/api/settings" > /dev/null 2>&1; then
            log_success "API 服务器已启动: http://localhost:$API_PORT"
        else
            log_warning "API 服务器可能还在启动中..."
        fi

        log_info "启动 Web 前端 (端口 $FRONTEND_PORT)..."
        log_info "前端日志: $FRONTEND_LOG"
        pnpm --filter src dev >> "$FRONTEND_LOG" 2>&1 &
        FRONTEND_PID=$!

        log_success "所有服务已启动!"
        echo ""
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo -e "  API 服务器:  ${BLUE}http://localhost:$API_PORT${NC}"
        echo -e "  Web 前端:    ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
        echo -e "${GREEN}════════════════════════════════════════${NC}"
        echo ""
        echo "按 Ctrl+C 停止所有服务"
        echo ""

        # 等待子进程
        wait
        ;;
esac
