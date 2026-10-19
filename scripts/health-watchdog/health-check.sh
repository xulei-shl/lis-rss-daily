#!/usr/bin/env bash
#
# 机器健康检查：磁盘 I/O 错误 / cron 调度活性 / 关键服务
#
# 触发条件（任一命中即告警）：
#   1. 内核日志在最近 HEALTH_WINDOW_HOURS 小时内出现磁盘 I/O 错误或 ATA 异常
#   2. cron 在最近 HEALTH_CRON_STALE_MINUTES 分钟内没有执行过任何作业（曾出现 cron 僵死）
#   3. HEALTH_SERVICES 中「已启用」的服务不是 active（disabled 的服务视为按需启动，不告警）
#
# 告警复用主项目统一推送接口（/api/notify/cli，type=health_alert），
# 推送配置按键读取自 paper-pdf-summary/.env（BASE_URL / CLI_API_KEY / PDF_SUMMARY_NOTIFY_USER_ID），
# 实际接收渠道在设置页「通知」中按接收者独立勾选（服务器健康告警）。
# 每类问题独立冷却：同类告警在 HEALTH_COOLDOWN_SECONDS 秒内只推送一次，避免刷屏。
#
# 用法：health-check.sh [--dry-run]     # --dry-run 只打印，不推送、不写状态

set -uo pipefail

WINDOW_HOURS="${HEALTH_WINDOW_HOURS:-6}"
CRON_STALE_MINUTES="${HEALTH_CRON_STALE_MINUTES:-180}"
COOLDOWN_SECONDS="${HEALTH_COOLDOWN_SECONDS:-21600}"
SERVICES="${HEALTH_SERVICES:-lis-rss.service paper-pdf-summary-api.service paper-pdf-summary-telegram.service}"
STATE_DIR="${HEALTH_STATE_DIR:-/var/lib/health-watchdog}"
ENV_FILE="${HEALTH_ENV_FILE:-/opt/lis-rss-daily/scripts/paper-pdf-summary/.env}"

HOST="$(hostname)"
NOW="$(date +%s)"
DRY_RUN=0
TEST=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
[[ "${1:-}" == "--test" ]] && TEST=1

mkdir -p "${STATE_DIR}"

# 只按键读取 .env（.env 中夹杂了注释/分隔行，直接 source 会执行到非法命令）
env_value() {
  [[ -f "${ENV_FILE}" ]] || return 0
  sed -n "s/^${1}=//p" "${ENV_FILE}" | tail -1 | tr -d '\r' | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'
}

# 冷却检查：分类 disk / cron / service
in_cooldown() {  # $1=category  -> 0 表示仍在冷却中
  local stamp="${STATE_DIR}/last-sent-${1}" ts
  [[ -f "${stamp}" ]] || return 1
  ts="$(cat "${stamp}" 2>/dev/null || echo 0)"
  (( NOW - ts < COOLDOWN_SECONDS ))
}

issues=()
categories=()   # 与 issues 一一对应

add_issue() { issues+=("$2"); categories+=("$1"); }

# ---------------------------------------------------------------- 1. 磁盘 I/O
# 本机这块盘不支持 SMART（桥接为 SATA 暴露，smartctl 报 "lacks SMART capability"），
# 磁盘健康只能依据内核日志中的 I/O 错误与 ATA 链路异常判断。
disk_hits="$(journalctl -k --since "-${WINDOW_HOURS} hours" --no-pager 2>/dev/null \
  | grep -E "I/O error, dev sd|ata[0-9]+\.00: .*(exception|frozen)" || true)"
if [[ -n "${disk_hits}" ]]; then
  disk_count="$(printf '%s\n' "${disk_hits}" | wc -l)"
  disk_sectors="$(printf '%s\n' "${disk_hits}" | grep -oE 'sector [0-9]+' | sort -u | wc -l)"
  disk_last="$(printf '%s\n' "${disk_hits}" | tail -1 | grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]{8}' | tail -1)"
  add_issue disk "磁盘 I/O 错误：最近 ${WINDOW_HOURS} 小时内核日志出现 ${disk_count} 条，涉及 ${disk_sectors} 个扇区，最后一条 ${disk_last:-未知}（该盘已出现不可纠正读错误，软件无法修复，需尽快备份数据并更换磁盘）"
fi

# ------------------------------------------------------------ 2. cron 调度活性
# 任何用户/系统的 cron 作业都会留下 CMD 记录；连续无记录说明调度停摆
last_cron_epoch="$(journalctl -u cron --since "-$(( CRON_STALE_MINUTES * 2 )) min" --no-pager -o short-unix 2>/dev/null \
  | grep -E " CMD \(" | tail -1 | cut -d' ' -f1)"
last_cron_epoch="${last_cron_epoch%%.*}"
if [[ -z "${last_cron_epoch}" ]] || (( NOW - last_cron_epoch >= CRON_STALE_MINUTES * 60 )); then
  cron_age_minutes="-"
  [[ -n "${last_cron_epoch}" ]] && cron_age_minutes=$(( (NOW - last_cron_epoch) / 60 ))
  add_issue cron "cron 停摆：最近一次 cron 作业在 ${cron_age_minutes} 分钟前（阈值 ${CRON_STALE_MINUTES} 分钟），每日定时任务可能未运行；排查 systemctl status cron / journalctl -u cron"
fi

# ----------------------------------------------------------------- 3. 关键服务
for svc in ${SERVICES}; do
  enabled="$(systemctl is-enabled "${svc}" 2>/dev/null || true)"
  state="$(systemctl is-active "${svc}" 2>/dev/null || true)"
  # disabled 的服务按需启动，不在自动告警范围内
  [[ "${enabled}" == "disabled" ]] && continue
  if [[ "${state}" != "active" ]]; then
    add_issue service "服务异常：${svc} 当前状态 ${state:-unknown}（is-enabled=${enabled:-unknown}），用 systemctl status ${svc} 排查"
  fi
done

# ---------------------------------------------------------------- 测试推送
# --test：跳过检查，用同一套推送链路发一条测试告警，用于验证推送通道
if (( TEST )); then
  issues=("测试：本条由 health-check.sh --test 触发，仅用于验证推送通道")
  categories=(test)
fi

# ---------------------------------------------------------------------- 汇总
if (( ${#issues[@]} == 0 )); then
  echo "[$(date '+%F %T')] 健康检查通过：磁盘无新 I/O 错误、cron 正常、已启用服务均 active"
  exit 0
fi

message="【健康告警】${HOST} $(date '+%F %T')"$'\n'
pending=()
for i in "${!issues[@]}"; do
  if in_cooldown "${categories[$i]}"; then
    echo "跳过（${categories[$i]} 类告警仍在冷却期内）：${issues[$i]}"
    continue
  fi
  pending+=("${categories[$i]}")
  message+="- ${issues[$i]}"$'\n'
done

if (( ${#pending[@]} == 0 )); then
  echo "所有告警均在冷却期内，本次不推送"
  exit 0
fi

echo "${message}"
if (( DRY_RUN )); then
  echo "--dry-run：未推送、未更新冷却状态"
  exit 0
fi

base_url="$(env_value BASE_URL)"
[[ -z "${base_url}" ]] && base_url="$(env_value LIS_RSS_API_URL)"
[[ -z "${base_url}" ]] && base_url="http://localhost:8007"
base_url="${base_url%/}"
user_id="$(env_value PDF_SUMMARY_NOTIFY_USER_ID)"
[[ -z "${user_id}" ]] && user_id="1"
api_key="$(env_value CLI_API_KEY)"

payload="$(python3 - "${message}" <<'PY'
import json, sys
print(json.dumps({
    "type": "health_alert",
    "title": "服务器健康告警",
    "sourceName": "health-watchdog",
    "summary": sys.argv[1],
    "success": True,
}, ensure_ascii=False))
PY
)"

resp="$(curl -sS -m 20 -X POST "${base_url}/api/notify/cli?user_id=${user_id}" \
  -H 'Content-Type: application/json' -H "x-api-key: ${api_key}" -d "${payload}" 2>&1)"
echo "推送响应: ${resp:-<空>}"

if [[ "${resp}" == *'"notified": true'* || "${resp}" == *'"notified":true'* ]]; then
  for cat in "${pending[@]}"; do date +%s > "${STATE_DIR}/last-sent-${cat}"; done
  echo "推送成功，已记录冷却时间戳（${pending[*]}）"
  exit 0
fi

echo "推送失败：请检查 BASE_URL / CLI_API_KEY 配置与主项目服务状态"
exit 1
