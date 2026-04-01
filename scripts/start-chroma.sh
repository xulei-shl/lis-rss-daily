#!/bin/bash

# LIS-RSS Literature Tracker - Chroma Startup Script
# This script ensures Chroma is properly started before continuing

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
echo "  LIS-RSS Literature Tracker - Chroma Startup"
echo "==============================================="
echo ""

# Set Chroma environment variables
export CHROMA_HOST="127.0.0.1"
export CHROMA_PORT="8000"
export CHROMA_DATA_DIR="$(pwd)/data/vector/chroma"
export CHROMA_LOG_DIR="$(pwd)/logs"
export CHROMA_MAX_WAIT=30

# Create necessary directories
print_info "Creating necessary directories..."
mkdir -p "data/vector/chroma" "logs"
print_success "Directory check completed"

# Check if chroma command is available
print_info "Checking chroma command..."
if ! command -v chroma >/dev/null 2>&1; then
    print_warning "chroma command not found"
    print_info "Vector search will be disabled"
    print_info "To enable: pip install chromadb"
    exit 0
fi
print_success "chroma command available"

# Check if Chroma is already running
print_info "Checking if Chroma is already running..."
if curl -s "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v1/heartbeat" >/dev/null 2>&1; then
    print_success "Chroma is already running and healthy"
    exit 0
fi

# Check if port is in use by another service
if lsof -i ":${CHROMA_PORT}" >/dev/null 2>&1 || netstat -an 2>/dev/null | grep "\.${CHROMA_PORT} " | grep LISTEN >/dev/null; then
    print_warning "Port ${CHROMA_PORT} is in use but Chroma is not responding"
    print_info "Please check if another service is using port ${CHROMA_PORT}"
    exit 0
fi

# Start Chroma in background
print_info "Starting Chroma vector database service..."
nohup chroma run --host "$CHROMA_HOST" --port "$CHROMA_PORT" --path "$CHROMA_DATA_DIR" > "${CHROMA_LOG_DIR}/chroma.log" 2>&1 &
CHROMA_PID=$!
echo "$CHROMA_PID" > "${CHROMA_LOG_DIR}/chroma.pid"

# Wait for Chroma to be ready with health check
print_info "Waiting for Chroma to be ready (max ${CHROMA_MAX_WAIT} seconds)..."

WAIT_COUNT=0
while [ $WAIT_COUNT -lt $CHROMA_MAX_WAIT ]; do
    if curl -s "http://${CHROMA_HOST}:${CHROMA_PORT}/api/v1/heartbeat" >/dev/null 2>&1; then
        print_success "Chroma is ready at http://${CHROMA_HOST}:${CHROMA_PORT}"
        exit 0
    fi

    # Wait 1 second and retry
    WAIT_COUNT=$((WAIT_COUNT + 1))
    REMAINING=$((CHROMA_MAX_WAIT - WAIT_COUNT))
    echo -ne "Waiting... (${REMAINING}s remaining) \r"
    sleep 1
done

print_error "Chroma failed to start within ${CHROMA_MAX_WAIT} seconds"
print_info "Check logs at: ${CHROMA_LOG_DIR}/chroma.log"
print_warning "Vector search will be disabled"
