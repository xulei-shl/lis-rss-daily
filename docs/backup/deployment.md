# 部署文档

本文档介绍如何在不同环境下部署 RSS Literature Tracker 系统。

---

## 目录

- [系统要求](#系统要求)
- [本地部署](#本地部署)
- [Docker 部署](#docker-部署)
- [生产环境部署](#生产环境部署)
- [反向代理配置](#反向代理配置)
- [监控与维护](#监控与维护)
- [故障排查](#故障排查)

---

## 系统要求

### 最低配置

| 项目 | 要求 |
|------|------|
| 操作系统 | Linux / macOS / Windows |
| CPU | 2 核心以上 |
| 内存 | 2GB 以上 |
| 磁盘 | 10GB 可用空间 |
| Node.js | >= 18.0.0 |
| pnpm | >= 8.0.0 |

### 推荐配置

| 项目 | 要求 |
|------|------|
| CPU | 4 核心以上 |
| 内存 | 4GB 以上 |
| 磁盘 | 50GB 以上 (含导出文件和日志) |

---

## 本地部署

### 1. 安装依赖

```bash
# 安装 Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 pnpm
npm install -g pnpm
```

### 2. 克隆项目

```bash
git clone https://github.com/yourusername/lis-rss-daily.git
cd lis-rss-daily
```

### 3. 安装项目依赖

```bash
pnpm install
```

### 4. 配置环境变量

```bash
cp .env.example .env
nano .env  # 编辑配置文件
```

**必需配置项**：

```bash
# LLM API (必需)
OPENAI_API_KEY=sk-your-api-key-here

# 基础配置
PORT=3000
NODE_ENV=production
```

### 5. 初始化数据库

```bash
pnpm run db:migrate
```

### 6. 启动服务

```bash
# 开发模式
pnpm dev

# 生产模式 (使用 PM2)
npm install -g pm2
pm2 start "pnpm dev" --name lis-rss-daily
pm2 save
pm2 startup
```

### 7. 验证部署

访问 `http://localhost:3000`，使用默认账号登录：

- 用户名: `admin`
- 密码: `admin123`

**重要**: 首次登录后请立即修改密码！

---

## Docker 部署

### Docker 单容器部署

#### 1. 构建镜像

```bash
docker build -t lis-rss-daily:latest .
```

#### 2. 准备环境变量文件

```bash
cp .env.example .env.docker
nano .env.docker  # 编辑配置
```

#### 3. 运行容器

```bash
docker run -d \
  --name lis-rss-daily \
  -p 3000:3000 \
  --env-file .env.docker \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  lis-rss-daily:latest
```

#### 4. 查看日志

```bash
docker logs -f lis-rss-daily
```

### Docker Compose 部署

#### 1. 使用 docker-compose.yml

```bash
docker-compose up -d
```

#### 2. 查看状态

```bash
docker-compose ps
docker-compose logs -f
```

#### 3. 停止服务

```bash
docker-compose down
```

#### 4. 重新构建

```bash
docker-compose up -d --build
```

---

## 生产环境部署

### 使用 PM2 (推荐)

#### 1. 安装 PM2

```bash
npm install -g pm2
```

#### 2. 创建 PM2 配置文件

创建 `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'lis-rss-daily',
    script: 'src/index.ts',
    interpreter: 'node_modules/.bin/tsx',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

#### 3. 启动应用

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### 4. PM2 常用命令

```bash
pm2 list           # 查看所有进程
pm2 logs           # 查看日志
pm2 restart all    # 重启所有进程
pm2 stop all       # 停止所有进程
pm2 delete all     # 删除所有进程
pm2 monit          # 监控面板
```

### 使用 Systemd

创建 `/etc/systemd/system/lis-rss-daily.service`:

```ini
[Unit]
Description=RSS Literature Tracker
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/lis-rss-daily
ExecStart=/usr/bin/node /usr/local/bin/tsx src/index.ts
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable lis-rss-daily
sudo systemctl start lis-rss-daily
sudo systemctl status lis-rss-daily
```

---

## 反向代理配置

### Nginx 配置

创建 `/etc/nginx/sites-available/lis-rss-daily`:

```nginx
upstream lis_rss_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://lis_rss_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/lis-rss-daily /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### HTTPS 配置 (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 监控与维护

### 日志管理

日志文件位置：

- 应用日志: `logs/app.log`
- 错误日志: `logs/error.log`
- PM2 日志: `logs/pm2-*.log`

日志轮转配置 (logrotate):

创建 `/etc/logrotate.d/lis-rss-daily`:

```
/var/www/lis-rss-daily/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        pm2 reload lis-rss-daily
    endscript
}
```

### 数据库备份

备份脚本 `scripts/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/lis-rss-daily"
DATA_DIR="/var/www/lis-rss-daily/data"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
cp "$DATA_DIR/database.sqlite" "$BACKUP_DIR/database_$DATE.sqlite"
find "$BACKUP_DIR" -name "database_*.sqlite" -mtime +7 -delete
```

添加定时任务：

```bash
crontab -e
# 每天凌晨 2 点备份数据库
0 2 * * * /var/www/lis-rss-daily/scripts/backup.sh
```

### 健康检查

创建健康检查端点或使用外部监控：

```bash
# 简单的 curl 检查
curl -f http://localhost:3000/api/scheduler/status || echo "Service down"
```

---

## 故障排查

### 常见问题

#### 1. 端口被占用

```bash
# 查看占用端口的进程
lsof -i :3000
# 或
netstat -tlnp | grep :3000

# 杀死进程
kill -9 <PID>
```

#### 2. 数据库锁定

```bash
# 检查是否有其他进程占用数据库
lsof data/database.sqlite

# 重启服务
pm2 restart lis-rss-daily
```

#### 3. LLM API 调用失败

检查环境变量和网络连接：

```bash
echo $OPENAI_API_KEY
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

#### 4. Playwright 浏览器无法启动

安装依赖：

```bash
# Linux
npx playwright install-deps chromium

# 所有平台
npx playwright install chromium
```

#### 5. 内存不足

调整配置：

```bash
# .env
ARTICLE_PROCESS_MAX_CONCURRENT=1  # 降低并发
RSS_MAX_CONCURRENT=2              # 降低 RSS 并发
```

### 日志分析

```bash
# 查看最近错误
tail -f logs/error.log

# 搜索特定关键词
grep "ERROR" logs/app.log | tail -20

# 统计错误类型
grep "ERROR" logs/app.log | awk '{print $NF}' | sort | uniq -c
```

---

## 安全建议

1. **修改默认密码**: 首次登录后立即修改 admin 密码
2. **环境变量保护**: 确保 `.env` 文件不被提交到版本控制
3. **HTTPS**: 生产环境必须启用 HTTPS
4. **防火墙**: 限制数据库端口访问
5. **定期更新**: 保持依赖包和系统更新
6. **备份**: 定期备份数据库和导出文件

---

## 性能优化

### 数据库优化

```sql
-- 创建索引
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_filter_status ON articles(filter_status);
CREATE INDEX IF NOT EXISTS idx_articles_process_status ON articles(process_status);
```

### 缓存策略

- 启用 Nginx 静态文件缓存
- 考虑添加 Redis 缓存层

---

## 更新升级

```bash
# 拉取最新代码
git pull origin main

# 安装新依赖
pnpm install

# 运行数据库迁移
pnpm run db:migrate

# 重启服务
pm2 restart lis-rss-daily
```

---

## 支持与帮助

- GitHub Issues: [提交问题](https://github.com/yourusername/lis-rss-daily/issues)
- 开发文档: [开发者指南](developer-guide.md)
