#!/bin/bash

# LIS-RSS Literature Tracker - Linux/macOS Startup Script

set -e

# Switch to parent directory of the script
cd "$(dirname "$0")/.."

echo ""
echo "==============================================="
echo "  LIS-RSS Literature Tracker - Startup Script"
echo "==============================================="
echo ""

# Start Chroma first (non-blocking)
bash "$(dirname "$0")/start-chroma.sh"

# Start the application
exec bash "$(dirname "$0")/start-app.sh"
