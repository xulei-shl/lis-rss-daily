#!/bin/bash
#
# 每日总结自动生成脚本
# 用法: ./auto-daily-summary.sh [journal|blog_news]
#

set -e

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 加载 .env 文件（跳过无效的 shell 语法行）
if [ -f "$PROJECT_DIR/.env" ]; then
    while IFS='=' read -r key value; do
        # 跳过注释行和空行
        [[ "$key" =~ ^#.*$ ]] && continue
        [[ -z "$key" ]] && continue
        # 跳过包含特殊字符的值（如 cron 表达式）
        [[ "$value" =~ ^[0-9\*\s]+$ ]] && continue
        export "$key=$value"
    done < "$PROJECT_DIR/.env"
fi

# 配置
BASE_URL="${BASE_URL:-http://localhost:8007}"
USER_ID="${USER_ID:-1}"
CLI_API_KEY="${CLI_API_KEY}"
LOG_FILE="${LOG_FILE:-logs/auto-daily-summary.log}"

# 类型参数 (journal 或 blog_news)
TYPE="$1"

if [ -z "$TYPE" ]; then
    echo "错误: 必须指定总结类型 (journal 或 blog_news)" >&2
    exit 1
fi

# 验证 TYPE 参数值
if [[ "$TYPE" != "journal" && "$TYPE" != "blog_news" ]]; then
    echo "错误: TYPE 必须是 'journal' 或 'blog_news'，当前值: '$TYPE'" >&2
    exit 1
fi

if [ -z "$CLI_API_KEY" ]; then
    echo "错误: 必须设置 CLI_API_KEY 环境变量" >&2
    exit 1
fi

# 创建日志目录
mkdir -p "$(dirname "$LOG_FILE")"

# 记录日志
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$TYPE] $1" | tee -a "$LOG_FILE"
}

log "开始生成 $TYPE 总结"

# 调用 API
RESPONSE=$(curl -s -X POST \
    "${BASE_URL}/api/daily-summary/cli?user_id=${USER_ID}&api_key=${CLI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"$TYPE\", \"limit\": 30}" \
    -w "\n%{http_code}")

# 提取 HTTP 状态码
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    # 解析响应
    STATUS=$(echo "$BODY" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$STATUS" ]; then
        log "❌ 响应格式错误，无法解析 status 字段: $BODY"
        exit 1
    fi

    if [ "$STATUS" = "success" ]; then
        TOTAL=$(echo "$BODY" | grep -o '"totalArticles":[0-9]*' | cut -d':' -f2)
        log "✅ 生成成功，共 $TOTAL 篇文章"
    elif [ "$STATUS" = "empty" ]; then
        log "⚠️  当日无通过的文章"
    else
        log "❌ 生成失败 (status=$STATUS): $BODY"
    fi
else
    log "❌ API 调用失败 (HTTP $HTTP_CODE): $BODY"
    exit 1
fi
