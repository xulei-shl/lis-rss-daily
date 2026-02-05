#!/bin/bash

# RSS Literature Tracker - Linux/macOS 启动脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 检查环境变量
check_env_file() {
    if [ ! -f .env ]; then
        print_warning ".env 文件不存在"
        if [ -f .env.example ]; then
            print_info "从 .env.example 复制配置..."
            cp .env.example .env
            print_warning "请编辑 .env 文件，添加你的 OPENAI_API_KEY"
            read -p "按 Enter 继续编辑 .env 文件..."
            ${EDITOR:-nano} .env
        else
            print_error ".env.example 文件不存在，无法创建配置文件"
            exit 1
        fi
    fi
}

# 检查 Node.js
check_nodejs() {
    if ! command_exists node; then
        print_error "Node.js 未安装"
        print_info "请访问 https://nodejs.org 下载安装 Node.js 18 或更高版本"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js 版本过低 (当前: $(node -v)，需要: >=18.0.0)"
        exit 1
    fi

    print_success "Node.js 版本: $(node -v)"
}

# 检查 pnpm
check_pnpm() {
    if ! command_exists pnpm; then
        print_warning "pnpm 未安装，正在安装..."
        npm install -g pnpm
    fi

    print_success "pnpm 版本: $(pnpm -v)"
}

# 安装依赖
install_dependencies() {
    if [ ! -d node_modules ]; then
        print_info "安装项目依赖..."
        pnpm install
        print_success "依赖安装完成"
    else
        print_info "依赖已存在，跳过安装"
    fi
}

# 初始化数据库
init_database() {
    if [ ! -f data/database.sqlite ]; then
        print_info "初始化数据库..."
        pnpm run db:migrate
        print_success "数据库初始化完成"

        read -p "是否填充示例数据? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "填充示例数据..."
            pnpm run db:seed
            print_success "示例数据填充完成"
        fi
    else
        print_info "数据库已存在，跳过初始化"
    fi
}

# 创建必要的目录
create_directories() {
    print_info "创建必要的目录..."
    mkdir -p data/exports data/qmd logs
    print_success "目录创建完成"
}

# 检查环境变量
check_required_env() {
    print_info "检查环境变量..."

    source .env

    if [ -z "$OPENAI_API_KEY" ]; then
        print_warning "OPENAI_API_KEY 未设置"
        print_warning "LLM 分析功能将无法使用"
        read -p "是否继续启动? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_success "环境变量检查通过"
    fi
}

# 启动应用
start_app() {
    print_info "启动 RSS Literature Tracker..."
    echo ""
    print_success "==============================================="
    print_success "  RSS Literature Tracker 启动中..."
    print_success "  访问地址: http://localhost:3000"
    print_success "  默认用户: admin / admin123"
    print_success "==============================================="
    echo ""

    pnpm dev
}

# 主函数
main() {
    echo ""
    print_success "RSS Literature Tracker - 启动脚本"
    print_success "================================"
    echo ""

    # 切换到脚本所在目录的父目录
    cd "$(dirname "$0")/.."

    # 执行检查
    check_nodejs
    check_pnpm
    check_env_file
    create_directories
    install_dependencies
    init_database
    check_required_env

    # 启动应用
    start_app
}

# 捕获 Ctrl+C
trap 'print_warning "启动已取消"; exit 0' INT

# 运行主函数
main
