# 机器健康告警（health-watchdog）

针对本机曾经出现过的两类静默故障 —— **磁盘 I/O 错误**（已导致 cron 作业表失效、每日定时任务停摆）和 **cron 停摆** —— 提供轻量健康检查与推送告警。

## 检查项

| 检查 | 触发条件 | 默认阈值 |
|------|---------|---------|
| 磁盘 I/O | 内核日志出现 `I/O error, dev sd` 或 `ataX.00 ... exception/frozen` | 最近 6 小时 |
| cron 活性 | 最近没有任何 cron 作业的 `(用户) CMD` 记录 | 180 分钟 |
| 关键服务 | 已启用（`is-enabled` ≠ `disabled`）的服务状态不是 `active` | lis-rss / paper-pdf-summary-api / paper-pdf-summary-telegram |

> 本机这块盘（桥接为 SATA 的 NVMe）**不支持 SMART**（`smartctl -a` 报 "device lacks SMART capability"），因此磁盘健康只能依据内核 I/O 错误日志判断。

## 安装

```bash
sudo cp deploy/health-watchdog.service deploy/health-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now health-watchdog.timer
systemctl list-timers health-watchdog.timer
```

## 使用

```bash
# 先干跑一遍（只打印，不推送、不写状态）
/opt/lis-rss-daily/scripts/health-watchdog/health-check.sh --dry-run

# 验证推送通道：跳过检查，发一条测试告警（同样受冷却限制）
sudo /opt/lis-rss-daily/scripts/health-watchdog/health-check.sh --test

# 真实执行一次（有问题时推送到主项目统一推送渠道）
sudo /opt/lis-rss-daily/scripts/health-watchdog/health-check.sh

# 看上一次定时执行的日志
journalctl -u health-watchdog.service --since today
```

## 配置

通过环境变量覆盖默认值（可在 systemd unit 的 `Environment=` 里设置）：

| 变量 | 说明 | 默认 |
|------|------|------|
| `HEALTH_WINDOW_HOURS` | 磁盘 I/O 错误统计窗口 | `6` |
| `HEALTH_CRON_STALE_MINUTES` | cron 停摆判定阈值 | `180` |
| `HEALTH_SERVICES` | 需要检查的服务列表（空格分隔） | lis-rss 等三个 |
| `HEALTH_COOLDOWN_SECONDS` | 同类告警推送冷却时间（磁盘/cron/服务各自独立计时）| `21600`（6 小时）|
| `HEALTH_STATE_DIR` | 冷却状态目录 | `/var/lib/health-watchdog` |
| `HEALTH_ENV_FILE` | 推送配置来源的 .env 路径 | `scripts/paper-pdf-summary/.env` |

推送走主项目 `/api/notify/cli`（`type=health_alert`）。实际接收渠道在设置页「通知 → Telegram 通知 / 企业微信推送」中，为每个接收者/webhook 单独勾选「接收服务器健康告警」。

- 健康告警是独立的推送类型 `health_alert`，与「PDF 全文总结」互不影响。
- 升级时已有接收者沿用原「PDF 全文总结」的勾选状态，避免告警静默消失。
- 新增接收者默认**不**接收健康告警，需要手动勾选。

## 实现要点

- 冷却状态写在 `HEALTH_STATE_DIR` 下的 `last-sent-<类别>` 文件，三类问题互不影响。
- 推送配置从 `.env` **按键读取**（该文件里混有注释与分隔行，直接 `source` 会执行到非法命令）。
- 健康告警使用独立的 `health_alert` 推送类型，不会混入 PDF 总结订阅者。
- `disabled` 的服务（如 `paper-pdf-summary-api.service`，按需手动启动）不会告警。

## 局限

- 只能"发现问题"，不能修复磁盘：出现不可纠正读错误（`UNC`）的块无法由软件恢复，应尽快备份数据并更换磁盘。
- 检查依赖 systemd-journald 中的内核日志；若 journal 日志被清空或限制，需要改用 `/var/log/syslog`。
