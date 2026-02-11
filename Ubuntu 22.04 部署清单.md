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

使用 NodeSource 仓库安装最新 LTS 版本：

```bash
# 导入 NodeSource GPG 密钥
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js
sudo apt-get install -y nodejs

# 验证安装
node -v
npm -v
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
# 安装项目依赖
pnpm install

# 重新编译原生模块（better-sqlite3 需要在目标平台编译）
pnpm rebuild better-sqlite3

# 如果 rebuild 失败，尝试强制重装
pnpm install --force
```

### 7. 安装 ChromaDB

```bash
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
PORT=3000
BASE_URL=http://localhost:3000

# ============ 数据库配置 ============
DATABASE_PATH=data/rss-tracker.db

# ============ JWT 认证 ============
# 生产环境必须修改！
JWT_SECRET=your-random-secret-key-change-this
JWT_EXPIRES_IN=7d

# ============ LLM 配置 ============
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=  # 可选，使用代理时填写
OPENAI_DEFAULT_MODEL=gpt-4o-mini

# LLM 加密密钥（生产环境必须修改！）
LLM_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000000

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

# 可选：创建种子数据（测试用户等）
pnpm run db:seed
```

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
curl http://localhost:3000

# 检查 ChromaDB 是否运行
curl http://127.0.0.1:8000/api/v1/heartbeat
```

访问 `http://your-server-ip:3000`，使用默认账号登录：
- 用户名：`admin`
- 密码：`admin123`

**登录后立即修改密码！**

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
Environment="PORT=3000"
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

## 配置 Nginx 反向代理（可选）

如果需要通过域名访问，配置 Nginx：

```bash
sudo apt-get install -y nginx
sudo vim /etc/nginx/sites-available/lis-rss
```

配置内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/lis-rss /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 防火墙配置

```bash
# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 如果不使用 Nginx，直接允许应用端口
sudo ufw allow 3000/tcp

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
sudo netstat -tulpn | grep 3000
sudo lsof -i :3000
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
