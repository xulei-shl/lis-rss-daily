#!/bin/bash

# LIS-RSS Literature Tracker - Application Startup Script

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

# Switch to parent directory of the script
cd "$(dirname "$0")/.."

echo ""
echo "==============================================="
echo "  LIS-RSS Literature Tracker - Application Startup"
echo "==============================================="
echo ""

# Check Node.js
print_info "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js not installed"
    print_info "Please visit https://nodejs.org to download and install Node.js 18 or higher"
    exit 1
fi

NODE_VERSION=$(node -v)
NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
    print_error "Node.js version is too old (requires version 18 or higher)"
    exit 1
fi

print_success "Node.js version: ${NODE_VERSION}"

# Check pnpm
print_info "Checking pnpm..."
if ! command -v pnpm >/dev/null 2>&1; then
    print_warning "pnpm not installed, installing..."
    npm install -g pnpm
fi
print_success "pnpm is installed"

# Create necessary directories
print_info "Creating necessary directories..."
mkdir -p "data/exports" "logs"
print_success "Directory creation completed"

# Install dependencies
if [ ! -d node_modules ]; then
    print_info "Installing project dependencies..."
    pnpm install
    print_success "Dependencies installed"
else
    print_info "Dependencies already exist, skipping"
fi

# Initialize database
if [ ! -f "data/rss-tracker.db" ]; then
    print_info "Initializing database..."
    if ! pnpm run db:migrate; then
        print_error "Database migration failed, please check logs"
        exit 1
    fi
    print_success "Database initialization completed"
else
    print_info "Database already exists, skipping initialization"
fi

# Clear screen and show startup banner
clear

echo ""
echo "==============================================="
echo "  LIS-RSS Literature Tracker"
echo "==============================================="
echo "  Access URL: http://localhost:3000"
echo "  Default User: admin / admin123"
echo "  Chroma API: http://127.0.0.1:8000"
echo "==============================================="
echo ""
print_info "Starting development server..."
echo ""

# Start the application
exec pnpm dev
