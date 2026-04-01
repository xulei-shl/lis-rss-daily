# Ubuntu 22.04 部署清单

本文档详细记录在 Ubuntu 22.04 LTS 上部署 LIS-RSS Literature Tracker 的完整步骤。

---

## 前置要求

- 操作系统：Ubuntu 22.04 LTS (GNU/Linux 5.15.0-107-generic x86_64)
- Node.js：20.x 或更高版本
- Python：3.x（用于 ChromaDB）
- 权限：需要 sudo 权限安装系统依赖

---

## 部署步骤

### 1. 更新系统并安装基础工具

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential
```

### 2. 安装 Node.js 20+

推荐使用 `n` 工具快速安装 Node.js：

```bash
# 安装 n 工具
npm install -g n

# 安装 Node.js 24 (推荐)
n 24

# 刷新 shell 路径
hash -r

# 验证安装
node -v  # Should print "v24.x.x"
npm -v
```

> **注意**：Node.js 24+ 可解决 `undici` 库的兼容性问题（`File is not defined` 错误）。

### 3. 安装 pnpm

```bash
# 使用 npm 全局安装 pnpm
npm install -g pnpm

# 验证安装
pnpm -v
```

### 4. 安装 Python 和 pip

ChromaDB 需要 Python 环境：

```bash
# 安装 Python 3 和 pip
sudo apt-get install -y python3 python3-pip python3-venv

# 验证安装
python3 --version
pip3 --version
```

### 5. 克隆项目仓库

```bash
# 克隆项目（替换为你的仓库地址）
cd /opt
sudo git clone <your-repo-url> lis-rss-daily
cd lis-rss-daily

# 或如果已下载，直接进入目录
cd /path/to/lis-rss-daily
```

### 6. 安装 Node.js 依赖

```bash

# 配置 pnpm 使用淘宝镜像
pnpm config set registry https://registry.npmmirror.com

# 查看当前 registry 配置
pnpm config get registry

# 安装项目依赖
pnpm install

# 重新编译原生模块（better-sqlite3 需要在目标平台编译）
pnpm rebuild better-sqlite3

# 如果 rebuild 失败，尝试强制重装
pnpm install --force
```

### 7. 安装 ChromaDB 和 Python 依赖

```bash
# 创建虚拟环境
python3 -m venv lis-rss
source lis-rss/bin/activate

# 使用 pip 安装 ChromaDB
pip3 install chromadb

# 安装 Paper PDF API 和 DeepSearch API 所需依赖
pip3 install fastapi "uvicorn[standard]" pydantic python-telegram-bot httpx PyYAML aiohttp

# 安装 PDF 下载所需依赖（Camoufox 浏览器）
pip3 install camoufox

# 验证安装
chroma --version
```

### 7.1 安装系统依赖

```bash
# 安装 xvfb（用于无头浏览器 PDF 下载）
sudo apt-get update
sudo apt-get install -y xvfb

# 验证安装
xvfb-run --version
```

### 7.2 安装 DeepSearch API 虚拟环境

```bash
# 为 DeepSearch API 创建独立虚拟环境
python3 -m venv lis-rss-deepsearch
source lis-rss-deepsearch/bin/activate

# 安装依赖
pip3 install fastapi "uvicorn[standard]" pydantic python-telegram-bot httpx PyYAML

# 验证安装
uvicorn --version
```

### 7.3 安装 Telegram Bot 依赖

```bash
# 进入 telegram-bot 目录
cd /opt/lis-rss-daily/scripts/paper-pdf-summary/telegram-bot

# 安装 Node.js 依赖
pnpm install
```

### 8. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置文件
vim .env
# 或使用 nano
nano .env
```

**必须修改的配置项：**

```env
# ============ 服务配置 ============
PORT=8007
BASE_URL=http://localhost:8007

# ============ 数据库配置 ============
DATABASE_PATH=data/rss-tracker.db

# ============ JWT 认证 ============
# 用于签发用户登录 Token，生产环境必须使用强随机字符串！
# 生成方法：openssl rand -hex 32
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
JWT_EXPIRES_IN=7d

# ============ LLM 配置 ============
# LLM 配置请在 Web 界面中设置（设置 → LLM 配置）
# 以下密钥用于加密数据库中存储的 LLM API Key，必须是 64 位十六进制字符（32 字节）！
# 生成方法：openssl rand -hex 32
LLM_ENCRYPTION_KEY=a1b2c3d4e5f678901234567890123456789012345678901234567890123456789

# ============ RSS 抓取配置 ============
# 抓取时间（cron 表达式，默认每天凌晨 2 点）
RSS_FETCH_SCHEDULE=0 2 * * *
# 是否启用 RSS 抓取
RSS_FETCH_ENABLED=true
# 最大并发数
RSS_MAX_CONCURRENT=5
# 超时时间（毫秒）
RSS_FETCH_TIMEOUT=30000
# 首次运行最大文章数（首次抓取限制）
RSS_FIRST_RUN_MAX_ARTICLES=50

# ============ 相关文章刷新配置 ============
# 是否启用相关文章定期刷新
RELATED_REFRESH_ENABLED=true
# 刷新时间（cron 表达式，默认每天凌晨 3 点）
RELATED_REFRESH_SCHEDULE=0 3 * * *
# 每批处理数量
RELATED_REFRESH_BATCH_SIZE=100
# 刷新过期天数（超过此天数未刷新的文章会被重新处理）
RELATED_REFRESH_STALE_DAYS=7

# ============ 日志配置 ============
# 日志级别（debug | info | warn | error）
LOG_LEVEL=info
# 应用日志文件路径（留空则只输出到控制台）
LOG_FILE=
# LLM 调用日志文件路径（用于调试 LLM 调用）
LLM_LOG_FILE=
# 是否记录完整 Prompt（调试用，会占用大量空间）
LLM_LOG_FULL_PROMPT=false
# 完整 Prompt 采样率（百分比，0-100）
LLM_LOG_FULL_SAMPLE_RATE=20

# ============ LLM 限流配置 ============
# 是否启用 LLM 调用限流
LLM_RATE_LIMIT_ENABLED=true
# 每分钟最大请求数
LLM_RATE_LIMIT_REQUESTS_PER_MINUTE=60
# 突发容量（允许短时超过的请求数）
LLM_RATE_LIMIT_BURST_CAPACITY=10
# 队列超时时间（毫秒）
LLM_RATE_LIMIT_QUEUE_TIMEOUT=30000

# ============ CLI API 密钥（用于每日总结 CLI）=============
CLI_API_KEY=your-cli-api-key-here
```

### 9. 创建必要目录

```bash
# 创建数据和日志目录
mkdir -p data/exports logs data/vector/chroma
```

### 10. 初始化数据库

```bash
# 运行数据库迁移
pnpm run db:migrate
```

迁移会自动创建：
- 默认 admin 用户（密码：admin123）
- 必要的数据库表和索引
- 默认系统设置

### 11. 测试 ChromaDB 连接

```bash
# 启动 ChromaDB 测试连接
chroma run --host 127.0.0.1 --port 8000 --path ./data/vector/chroma
```

按 `Ctrl+C` 停止测试。

### 12. 启动应用

**方式一：使用启动脚本（推荐）**

```bash
# 赋予执行权限
chmod +x scripts/*.sh

# 启动应用（自动启动 ChromaDB 和应用）
bash scripts/start.sh
```

**方式二：手动启动**

```bash
# 终端1：启动 ChromaDB
chroma run --host 127.0.0.1 --port 8000 --path ./data/vector/chroma > logs/chroma.log 2>&1 &

# 终端2：启动应用
pnpm run dev
```

### 13. 验证部署

```bash
# 检查应用是否运行
curl http://localhost:8007

# 检查 ChromaDB 是否运行
curl http://127.0.0.1:8000/api/v1/heartbeat
```

访问 `http://your-server-ip:8007`，使用默认账号登录：
- 用户名：`admin`
- 密码：`admin123`

**登录后立即修改密码！** 生产环境请使用强密码。

---

## 配置为系统服务（生产环境）

> **前置检查**：
> ```bash
> # 查看当前用户名（替换配置中的 your-username）
> whoami
>
> # 查看 nvm 安装的 Node.js 路径（用于配置 PATH）
> which node
> which pnpm
> ```

### 配置示例（Root 用户）

如果你使用 root 用户（通过 `sudo -i` 切换），配置如下：

#### 1. 创建 ChromaDB 服务

```bash
vim /etc/systemd/system/chromadb.service
```

内容：

```ini
[Unit]
Description=ChromaDB Vector Database
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily
# PATH 包含 Python 虚拟环境的 bin 目录
Environment="PATH=/opt/lis-rss-daily/lis-rss/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/opt/lis-rss-daily/lis-rss/bin/chroma run --host 127.0.0.1 --port 8000 --path /opt/lis-rss-daily/data/vector/chroma
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### 2. 创建应用服务

```bash
vim /etc/systemd/system/lis-rss.service
```

内容：

```ini
[Unit]
Description=LIS-RSS Literature Tracker
After=network.target chromadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=/opt/lis-rss-daily/.env
ExecStart=/usr/local/bin/pnpm dev
Restart=always
RestartSec=10

# --- 防止进程残留配置 ---
KillMode=control-group
KillSignal=SIGINT
TimeoutStopSec=10
# ------------------------------

StandardOutput=journal
StandardError=journal
SyslogIdentifier=lis-rss

[Install]
WantedBy=multi-user.target
```
WantedBy=multi-user.target
```

---

### 配置示例（普通用户）

如果你使用普通用户（非 root），配置如下：

#### 1. 创建 ChromaDB 服务

```bash
# 替换 your-username 为实际用户名
sudo vim /etc/systemd/system/chromadb.service
```

内容：

```ini
[Unit]
Description=ChromaDB Vector Database
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/opt/lis-rss-daily
# PATH 包含 Python 虚拟环境的 bin 目录
Environment="PATH=/opt/lis-rss-daily/lis-rss/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/opt/lis-rss-daily/lis-rss/bin/chroma run --host 127.0.0.1 --port 8000 --path /opt/lis-rss-daily/data/vector/chroma
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable chromadb
sudo systemctl start chromadb
sudo systemctl status chromadb
```

### 2. 创建应用服务

```bash
cat > /etc/systemd/system/lis-rss.service << 'EOF'
[Unit]
Description=LIS-RSS Literature Tracker
After=network.target chromadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily
Environment="PATH=/root/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/root/.nvm/versions/node/v24.13.1/bin/pnpm dev
Restart=always
RestartSec=10
StandardOutput=append:/opt/lis-rss-daily/logs/app.log
StandardError=append:/opt/lis-rss-daily/logs/error.log

[Install]
WantedBy=multi-user.target
EOF

```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable chromadb
sudo systemctl enable lis-rss
sudo systemctl start chromadb
sudo systemctl start lis-rss
sudo systemctl status chromadb
sudo systemctl status lis-rss
```

---

### 快速对比

| 配置项 | Root 用户 | 普通用户 |
|--------|-----------|----------|
| User | `root` | `your-username` |
| PATH (Node.js) | `/root/.nvm/...` | `/home/your-username/.nvm/...` |
| 命令前缀 | 无需 `sudo` | 需要 `sudo` |

---

## 防火墙配置

```bash
# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 允许应用端口（主应用 + 附属服务）
sudo ufw allow 8007/tcp  # LIS-RSS 主应用
sudo ufw allow 8000/tcp  # ChromaDB
sudo ufw allow 8081/tcp # Paper PDF API
sudo ufw allow 8082/tcp # DeepSearch API

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

---

## 一键部署脚本

### 创建所有 systemd 服务

```bash
# 1. ChromaDB 服务
cat > /etc/systemd/system/chromadb.service << 'EOF'
[Unit]
Description=ChromaDB Vector Database
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily
Environment="PATH=/opt/lis-rss-daily/lis-rss/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/opt/lis-rss-daily/lis-rss/bin/chroma run --host 127.0.0.1 --port 8000 --path /opt/lis-rss-daily/data/vector/chroma
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 2. LIS-RSS 主应用服务
cat > /etc/systemd/system/lis-rss.service << 'EOF'
[Unit]
Description=LIS-RSS Literature Tracker
After=network.target chromadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=/opt/lis-rss-daily/.env
ExecStart=/usr/local/bin/pnpm dev
Restart=always
RestartSec=10

KillMode=control-group
KillSignal=SIGINT
TimeoutStopSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=lis-rss

[Install]
WantedBy=multi-user.target
EOF

# 3. DeepSearch API 服务
cat > /etc/systemd/system/deepsearch-api.service << 'EOF'
[Unit]
Description=DeepSearch API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily
ExecStart=/opt/lis-rss-daily/lis-rss-deepsearch/bin/uvicorn scripts.deepsearch.api:app --host 0.0.0.0 --port 8082
Restart=always
RestartSec=5
Environment="PATH=/opt/lis-rss-daily/lis-rss-deepsearch/bin:/usr/bin:/usr/local/bin"
Environment="DATABASE_PATH=/opt/lis-rss-daily/data/rss-tracker.db"

[Install]
WantedBy=multi-user.target
EOF

# 4. Paper PDF API 服务
cat > /etc/systemd/system/paper-pdf-api.service << 'EOF'
[Unit]
Description=Paper PDF Summary API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily/scripts/paper-pdf-summary
ExecStart=/opt/lis-rss-daily/lis-rss/bin/uvicorn api:app --host 0.0.0.0 --port 8081
Restart=always
RestartSec=5
Environment="PATH=/opt/lis-rss-daily/lis-rss/bin:/usr/bin:/usr/local/bin"

[Install]
WantedBy=multi-user.target
EOF

# 5. Paper PDF Telegram Bot 服务
cat > /etc/systemd/system/paper-pdf-summary-telegram.service << 'EOF'
[Unit]
Description=Paper PDF Summary Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lis-rss-daily/scripts/paper-pdf-summary/telegram-bot
ExecStart=/usr/local/bin/node /opt/lis-rss-daily/scripts/paper-pdf-summary/telegram-bot/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs /opt/lis-rss-daily/scripts/paper-pdf-summary/telegram-bot/index.ts
Restart=always
RestartSec=5
Environment="PATH=/usr/local/bin:/usr/bin"
EnvironmentFile=/opt/lis-rss-daily/scripts/paper-pdf-summary/.env

[Install]
WantedBy=multi-user.target
EOF
```

### 启动所有服务

```bash
# 重新加载 systemd
systemctl daemon-reload

# 启用所有服务
systemctl enable chromadb lis-rss deepsearch-api paper-pdf-api paper-pdf-summary-telegram

# 按依赖顺序启动
systemctl start chromadb
sleep 3
systemctl start lis-rss
systemctl start deepsearch-api
systemctl start paper-pdf-api
systemctl start paper-pdf-summary-telegram

# 验证所有服务状态
systemctl status chromadb lis-rss deepsearch-api paper-pdf-api paper-pdf-summary-telegram
```

### 服务端口一览

| 服务 | 端口 | 说明 |
|------|------|------|
| ChromaDB | 8000 | 向量数据库 |
| LIS-RSS | 8007 | 主应用 Web UI |
| DeepSearch API | 8082 | 深度检索 API |
| Paper PDF API | 8081 | PDF 处理 API |
| Paper PDF Telegram Bot | - | Telegram 机器人（无端口）|

---

## 常见问题排查

### better-sqlite3 编译失败

```bash
# 安装编译工具
sudo apt-get install -y build-essential python3

# 重新编译
pnpm rebuild better-sqlite3
```

### ChromaDB 连接失败

```bash
# 检查服务状态
sudo systemctl status chromadb

# 查看日志
sudo journalctl -u chromadb -f

# 手动测试
curl http://127.0.0.1:8000/api/v1/heartbeat
```

### 应用无法启动

```bash
# 查看应用日志
tail -f logs/app.log

# 查看系统服务日志
sudo journalctl -u lis-rss -f

# 检查端口占用
sudo netstat -tulpn | grep 8007
sudo lsof -i :8007
```

### 每日总结重复推送

**症状**：每日总结消息被重复推送 2-3 次（WeChat 和 Telegram 都出现）。

**原因**：有双重调度机制同时运行：
1. **crontab 定时任务**：通过 HTTP API 调用触发总结
2. **应用内置调度器**：在 `.env` 中配置的 `DAILY_SUMMARY_SCHEDULE` 定时任务

**排查**：
```bash
# 检查 crontab 中是否有每日总结任务
crontab -l | grep daily-summary

# 检查应用内置调度器配置
grep DAILY_SUMMARY_ENABLED /opt/lis-rss-daily/.env
```

**解决**：删除 crontab 中的任务，只使用应用内置调度器：
```bash
# 编辑 crontab
sudo crontab -e

# 删除或注释掉以下行：
# 30 5 * * * /opt/lis-rss-daily/scripts/auto-daily-summary.sh journal ...
# 35 5 * * * /opt/lis-rss-daily/scripts/auto-daily-summary.sh blog_news ...

# 保存后重启服务
sudo systemctl restart lis-rss
```

**说明**：
- 应用内置调度器在 `.env` 中配置：`DAILY_SUMMARY_SCHEDULE=0 7 * * *`
- 内置调度器支持多种总结类型：`journal`、`blog_news`、`journal_all`
- WeChat 和 Telegram 通知器都有 60 秒防重复机制，但多进程同时运行时会失效

### Telegram 推送失败

**症状**：每日总结或文章推送时，WeChat 正常但 Telegram 失败，日志中出现 `fetch failed` 或 `assert(dispatcher)` 错误。

**常见原因**：
1. **环境变量未正确加载**：直接运行 `node` 命令时不会加载 `.env` 文件
2. **HTTP_PROXY 未配置**：需要通过代理访问 Telegram API
3. **多个 Bot 实例冲突**：日志中出现 `Conflict: terminated by other getUpdates request`

**排查步骤**：

1. **检查环境变量配置**：
```bash
# 检查 .env 文件中是否有 HTTP_PROXY
cat .env | grep HTTP_PROXY

# 检查运行时的环境变量（需要通过主服务检查，不能单独用 node 测试）
# 在主服务日志中搜索 "proxy" 关键字
grep -i "proxy" logs/app.log | tail -10
```

2. **用 curl 快速测试**（隔离问题）：
```bash
# 获取 Bot token 和频道 ID（从 .env 或数据库中）
BOT_TOKEN="你的_BOT_TOKEN"
CHANNEL="@lisrsstracker"

# 测试发送消息（使用代理）
curl -x http://127.0.0.1:7890 -X POST \
  "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "'$CHANNEL'", "text": "Test from curl", "parse_mode": "HTML"}'
```

3. **检查是否有多个 Bot 实例**：
```bash
# 搜索日志中的冲突错误
grep -i "terminated by other getUpdates request" logs/app.log

# 检查残留进程
ps aux | grep -E "tsx.*src/index" | grep -v grep
```

4. **手动触发推送测试**：
```bash
# 使用 CLI API 触发推送
CLI_API_KEY="你的_CLI_API_KEY"
curl -X POST "http://localhost:8007/api/daily-summary/journal-all/cli?user_id=1&api_key=$CLI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-03-16"}'
```

**解决方案**：

1. **确保环境变量正确配置**：
```bash
# 检查 .env 文件内容
cat .env | grep -E "HTTP_PROXY|TELEGRAM_BOT_TOKEN"

# 重启服务确保环境变量重新加载
sudo systemctl restart lis-rss
```

2. **清理残留进程并重启**：
```bash
# 停止服务
sudo systemctl stop lis-rss

# 清理残留的 tsx 进程
pkill -f "tsx.*src/index"

# 重新启动
sudo systemctl start lis-rss

# 验证服务状态
sudo systemctl status lis-rss --no-pager
```

3. **检查 Telegram Bot 配置**：
```bash
# 查看数据库中的 Telegram 配置
sqlite3 data/rss-tracker.db "SELECT user_id, chat_id, chat_name, journal_all, is_daily_summary FROM telegram_chats;"
```

**最佳实践**：
- 调试时先用 `curl` 测试，快速确认代理和配置是否正确
- 不要直接用 `node` 命令测试应用代码，必须通过主服务或使用 `pnpm exec`
- 每次配置修改后重启服务，确保环境变量正确加载
- 日志中看到 `No HTTP proxy configured` 时，检查 `.env` 文件是否被正确读取

---

### tsx 依赖模块路径错误

**症状**：服务启动后立即退出，日志中可能出现 `MODULE_NOT_FOUND` 错误，提示找不到 tsx 模块。

**原因**：tsx 依赖版本不匹配或 pnpm 虚拟存储路径失效。

```bash
# 查看当前 tsx 版本
pnpm list tsx

# 重新安装依赖（使用 CI 模式避免交互提示）
CI=true pnpm install

# 重启服务
sudo systemctl restart lis-rss
```

**验证**：
```bash
sudo systemctl status lis-rss --no-pager
```

---

## 维护操作

### 更新代码

**正常更新（无本地修改）：**

```bash
cd /opt/lis-rss-daily
git pull origin main
pnpm install
pnpm rebuild better-sqlite3
sudo systemctl restart lis-rss
```

**有本地修改冲突时（强制覆盖本地）：**

```bash
# 方式一：强制重置到远程版本（丢弃所有本地修改）
git fetch origin main && git reset --hard origin/main

# 然后安装依赖并重启
pnpm install
pnpm rebuild better-sqlite3
sudo systemctl restart lis-rss
```

> **注意**：
> - `git reset --hard` 会永久丢弃所有本地代码修改
> - 数据库文件（`data/rss-tracker.db`）和环境变量（`.env`）不受影响
> - 如需保留本地修改，先使用 `git stash` 备份

### 放行服务器端口
```
# 1. 允许 8007 端口
sudo ufw allow 8007/tcp

# 2. 检查防火墙状态
sudo ufw status
```

### 备份数据库

```bash
# 备份 SQLite 数据库
cp data/rss-tracker.db data/rss-tracker.db.backup.$(date +%Y%m%d)

# 或使用自动化脚本
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

### 查看日志

```bash
# 应用日志
tail -f logs/app.log

# ChromaDB 日志
tail -f logs/chroma.log

# 系统服务日志
sudo journalctl -u lis-rss -f
sudo journalctl -u chromadb -f
```

### 重启服务

**简单重启：**

```bash
sudo systemctl restart chromadb
sudo systemctl restart lis-rss
```

---

## 项目重启最佳实践

### 日常重启（代码更新、配置修改）

```bash
# 仅重启应用服务
sudo systemctl restart lis-rss
# 验证状态
sudo systemctl status lis-rss --no-pager
```

### 彻底重启流程

仅当遇到以下情况时需要：
- ChromaDB 服务崩溃
- ChromaDB 版本或配置更新
- 端口占用无法释放

```bash
# 1. 停止所有服务
sudo systemctl stop lis-rss
sudo systemctl stop chromadb

# 2. 检查是否有残留进程
ps aux | grep -E 'chroma|tsx|node' | grep -v grep

# 3. 如果有残留进程，手动终止
pkill -f chroma
pkill -f "tsx src/index.ts"

# 4. 验证端口已释放
sudo lsof -i :8000  # ChromaDB 端口
sudo lsof -i :8007  # 应用端口

# 5. 按依赖顺序启动服务
sudo systemctl start chromadb
sleep 3  # 等待 ChromaDB 完全启动
sudo systemctl start lis-rss

# 6. 验证服务状态
sudo systemctl status chromadb
sudo systemctl status lis-rss
```

### ChromaDB 虚拟环境修复

如果 ChromaDB 服务启动失败（exit-code 203/EXEC），通常是虚拟环境损坏或缺失：

```bash
# 1. 检查虚拟环境是否存在
test -d /opt/lis-rss-daily/lis-rss && echo "venv exists" || echo "venv missing"

# 2. 重建虚拟环境
cd /opt/lis-rss-daily
python3 -m venv lis-rss

# 3. 安装 ChromaDB
/opt/lis-rss-daily/lis-rss/bin/pip install --upgrade pip
/opt/lis-rss-daily/lis-rss/bin/pip install chromadb

# 4. 重启 ChromaDB 服务
sudo systemctl start chromadb
```

### 服务状态检查

```bash
# 查看服务实时状态
sudo systemctl status chromadb --no-pager
sudo systemctl status lis-rss --no-pager

# 查看最近的日志
sudo journalctl -u chromadb -n 50 --no-pager
sudo journalctl -u lis-rss -n 50 --no-pager

# 实时跟踪日志
sudo journalctl -u chromadb -f
sudo journalctl -u lis-rss -f
```

### 常见重启场景

| 场景 | 操作 |
|------|------|
| 应用代码更新 | `git pull` + `systemctl restart lis-rss` |
| 应用配置修改 (.env) | `systemctl restart lis-rss` |
| 依赖更新 | `pnpm install` + `systemctl restart lis-rss` |
| 应用服务卡死 | `systemctl restart lis-rss` |
| ChromaDB 配置修改 | `systemctl restart chromadb` |
| ChromaDB 版本更新 | 重建虚拟环境 + `systemctl restart chromadb` |
| 端口占用无法释放 | 彻底重启流程 |
| ChromaDB 启动失败 | 重建虚拟环境 |

---

## 常见问题排查（新增）

### Node.js 版本问题

**症状**：`undici` 库报错 `ReferenceError: File is not defined`

**原因**：Node.js 18.x 与 `undici@7.x` 不兼容

**解决**：使用 Node.js 24+

```bash
# 安装 n 工具
npm install -g n

# 升级到 Node.js 24
n 24

# 重新编译 native 模块
pnpm rebuild better-sqlite3

# 重启服务
systemctl restart lis-rss
```

### Telegram Bot 启动失败

**症状**：日志显示 `TELEGRAM_BOT_TOKEN environment variable is not set`

**原因**：`.env` 文件中未配置 `TELEGRAM_BOT_TOKEN`

**解决**：在 `scripts/paper-pdf-summary/.env` 中添加：

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_USER_ID=your_user_id
TELEGRAM_API_URL=http://localhost:8081
HTTP_PROXY=http://127.0.0.1:7890
```

然后重启服务：
```bash
systemctl restart paper-pdf-summary-telegram
```

### PDF 下载失败

**症状**：日志显示 `No such file or directory: 'xvfb-run'`

**原因**：未安装 `xvfb` 系统依赖

**解决**：
```bash
sudo apt-get update
sudo apt-get install -y xvfb
systemctl restart paper-pdf-api
```

### tsx 路径问题

**症状**：`SyntaxError: missing ) after argument list` 在调用 `node_modules/.bin/tsx` 时

**原因**：pnpm 的 shim 脚本在 Node.js 24 下有问题

**解决**：直接使用 tsx 的完整路径：
```bash
# 替换 ExecStart 中的路径
ExecStart=/usr/local/bin/node /path/to/project/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs /path/to/project/index.ts
```

### DeepSearch API 导入错误

**症状**：`ModuleNotFoundError: No module named 'md_parser'`

**原因**：工作目录不正确

**解决**：确保 `WorkingDirectory` 设置为 `/opt/lis-rss-daily`

---

## 安全建议

1. **修改默认密码**：登录后立即修改 admin 密码
2. **修改 JWT_SECRET**：使用强随机字符串
3. **修改 LLM_ENCRYPTION_KEY**：生成 32 字节随机密钥
4. **配置防火墙**：仅开放必要端口
5. **使用 HTTPS**：生产环境配置 SSL 证书（Let's Encrypt）
6. **定期备份**：设置定时任务自动备份数据库
7. **更新依赖**：定期运行 `pnpm update` 检查安全更新
