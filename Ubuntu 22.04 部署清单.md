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

```bash
# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# in lieu of restarting the shell
\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install 24

# Verify the Node.js version:
node -v # Should print "v24.13.1".

# Verify npm version:
npm -v # Should print "11.8.0".

```

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

### 7. 安装 ChromaDB

```bash
# 虚拟环境
python3 -m venv lis-rss
source lis-rss/bin/activate

# 使用 pip 安装 ChromaDB
pip3 install chromadb

# 验证安装
chroma --version
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

### 1. 创建 ChromaDB 服务

```bash
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
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="CHROMA_HOST=127.0.0.1"
Environment="CHROMA_PORT=8000"
Environment="CHROMA_DATA_DIR=/opt/lis-rss-daily/data/vector/chroma"
ExecStart=/usr/local/bin/chroma run --host 127.0.0.1 --port 8000 --path /opt/lis-rss-daily/data/vector/chroma
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
sudo vim /etc/systemd/system/lis-rss.service
```

内容：

```ini
[Unit]
Description=LIS-RSS Literature Tracker
After=network.target chromadb.service

[Service]
Type=simple
User=your-username
WorkingDirectory=/opt/lis-rss-daily
Environment="NODE_ENV=production"
Environment="PORT=8007"
ExecStart=/usr/local/bin/pnpm start
Restart=always
RestartSec=10
StandardOutput=append:/opt/lis-rss-daily/logs/app.log
StandardError=append:/opt/lis-rss-daily/logs/error.log

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable lis-rss
sudo systemctl start lis-rss
sudo systemctl status lis-rss
```

---

## 防火墙配置

```bash
# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 如果不使用 Nginx，直接允许应用端口
sudo ufw allow 8007/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

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

---

## 维护操作

### 更新代码

```bash
cd /opt/lis-rss-daily
git pull origin main
pnpm install
pnpm rebuild better-sqlite3
sudo systemctl restart lis-rss
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

```bash
sudo systemctl restart chromadb
sudo systemctl restart lis-rss
```

---

## 安全建议

1. **修改默认密码**：登录后立即修改 admin 密码
2. **修改 JWT_SECRET**：使用强随机字符串
3. **修改 LLM_ENCRYPTION_KEY**：生成 32 字节随机密钥
4. **配置防火墙**：仅开放必要端口
5. **使用 HTTPS**：生产环境配置 SSL 证书（Let's Encrypt）
6. **定期备份**：设置定时任务自动备份数据库
7. **更新依赖**：定期运行 `pnpm update` 检查安全更新
