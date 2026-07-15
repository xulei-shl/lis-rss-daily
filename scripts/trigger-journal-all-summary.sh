#!/bin/bash
# 手动触发全部期刊总结 (journal_all) 生成，用于测试 LLM 提供商是否恢复正常
# 用法: bash scripts/trigger-journal-all-summary.sh [date]
#   date: 可选，YYYY-MM-DD 格式，默认今天

set -e

BASE_URL="${BASE_URL:-http://localhost:8007}"
API_KEY="${CLI_API_KEY:-sk-s8sdjn73nsdnau}"
DATE="${1:-$(date +%Y-%m-%d)}"

echo "=== 触发全部期刊总结生成 ==="
echo "日期: $DATE"
echo "接口: $BASE_URL/api/daily-summary/journal-all/cli"
echo ""

# 用 query param 传 user_id + api_key（requireCliAuth 要求）
RESPONSE=$(curl -s -X POST "$BASE_URL/api/daily-summary/journal-all/cli?user_id=1&api_key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"date\": \"$DATE\"}")

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"