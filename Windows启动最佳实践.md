# Windows 11 启动最佳实践

本文档记录在 Windows 11 上启动 LIS-RSS Literature Tracker 主程序的完整步骤。
与 `Ubuntu部署清单.md` 互补：Ubuntu 版面向 systemd 服务器部署，本文只覆盖 **Win11 本机启动主程序**。

> **实测环境**：Windows 11 / Node.js v24.13.0 / pnpm 10.6.1 / Python 3.14.2
> **实测结论**：`pnpm install` 后执行 `pnpm run dev`，`http://localhost:8007` 返回 HTTP 200。
> **可选组件**：ChromaDB 向量库未启动时主程序仍可正常启动（见 [7. ChromaDB（可选）](#7-chromadb可选)）。

---

## 0. 服务与端口一览

| 组件 | 端口 | Windows 上是否必需 |
|------|------|--------------------|
| LIS-RSS 主程序 | `8007` | ✅ 必需 |
| ChromaDB 向量库 | `8000` | ⭕ 可选，缺失时语义检索不可用 |
| DeepSearch API | `8082` | ⭕ 独立 Python 服务，本清单不涉及 |
| Paper PDF API | `8081` | ⭕ 独立 Python 服务，本清单不涉及 |

> ⚠️ **端口是 `8007`，不是 `3000`。** README 中的 `3000` 已过时，以 `.env` 中 `PORT` 为准。

---

## 1. 前置检查

在 PowerShell 中逐条确认：

```powershell
node -v      # 需 v20+，推荐 v24+（见 6.1）
pnpm -v      # 需 9+
git --version
```

本项目路径（下文命令均以此为准，如不同请自行替换）：

```powershell
Set-Location F:\Github\lis-rss-daily
```

---

## 2. 安装依赖（首次或依赖变更后必做）

```powershell
Set-Location F:\Github\lis-rss-daily
pnpm install
```

> **为什么必须做这一步**：跳过此步直接 `pnpm run dev` 会报
> `ERR_MODULE_NOT_FOUND: Cannot find package 'imapflow'`，服务直接退出。
> 出现该错误时，`pnpm install` 是标准解法。

依赖来自 npmmirror 镜像（仓库根目录 `.npmrc` 已配置），无需额外设置。

### 2.1 验证 better-sqlite3 原生模块

```powershell
node -e "const D=require('better-sqlite3');const db=new D(':memory:');console.log('sqlite ok',db.prepare('select 1 as t').get());db.close()"
```

预期输出 `sqlite ok { t: 1 }`。若报 `ERR_DLOPEN_FAILED`，见 [6.2](#62-better-sqlite3-编译失败err_dlopen_failed)。

---

## 3. 配置环境变量

仓库根目录已有 `.env`。如缺失则从模板创建：

```powershell
Copy-Item .env.example .env
```

**必须确认的配置项：**

```env
PORT=8007
BASE_URL=http://localhost:8007
DATABASE_PATH=data/rss-tracker.db
LOG_FILE=logs/app.log
```

**必须替换为强随机值的密钥**（生产/公网环境）：

```powershell
# Windows PowerShell 生成 64 位十六进制密钥
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

- `JWT_SECRET`：签发登录 Token 用
- `LLM_ENCRYPTION_KEY`：加密数据库中的 LLM API Key，必须是 64 位十六进制字符

> ⚠️ 密钥修改后必须重启主程序才生效。

---

## 4. 创建必要目录

```powershell
New-Item -ItemType Directory -Force -Path data\exports, logs, data\vector\chroma | Out-Null
```

---

## 5. 初始化数据库

```powershell
pnpm run db:migrate
```

迁移会创建默认 admin 用户、必要的表与索引、默认系统设置。

> **代码更新后若新增了 `sql/*.sql` 迁移文件，必须重新执行此命令**，否则会因缺表报错。

---

## 6. 启动主程序

### 6.0 单实例原则（最重要的一条）

**同一时刻只能运行一个主程序实例。** 多实例会导致：

- SQLite 并发写冲突 → `SQLITE_ERROR`，文章卡在翻译阶段
- Telegram Bot 报 `Conflict: terminated by other getUpdates request`（实测日志中出现过）

启动前先确认端口未被占用：

```powershell
Get-NetTCPConnection -LocalPort 8007 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

有输出说明已有实例在跑，不要重复启动，先执行 [第 9 节](#9-停止与重启) 停掉旧实例。

### 6.1 前台启动（开发/调试用）

```powershell
Set-Location F:\Github\lis-rss-daily
pnpm run dev
```

看到 `HTTP request ... path: "/"` 日志即启动成功。保持窗口打开，关窗口即停止服务。

### 6.2 后台启动（日常使用推荐）

已创建 `scripts\start.bat`（仓库内，**消息用纯 ASCII**，避免 cmd 按 GBK 解析 UTF-8 中文导致脚本解析失败）：

```bat
@echo off
cd /d F:\Github\lis-rss-daily

rem Refuse to start if port 8007 is already in use (avoid multi-instance)
netstat -ano | findstr /C:"LISTENING" | findstr /C:":8007 " >nul
if %errorlevel%==0 (
  echo [SKIP] Port 8007 already in use, service is running.
  pause
  exit /b 1
)

if not exist logs mkdir logs
powershell -NoProfile -Command "Start-Process -FilePath $env:ComSpec -ArgumentList '/c','pnpm run dev >> logs\app.log 2>&1' -WorkingDirectory 'F:\Github\lis-rss-daily' -WindowStyle Hidden"
echo [OK] Starting in background, open http://localhost:8007 in a moment.
```

双击或命令行执行：

```powershell
.\scripts\start.bat
```

### 6.3 开机/登录自启（计划任务）

```powershell
schtasks /Create /TN "LIS-RSS-Start" `
  /TR "cmd /c F:\Github\lis-rss-daily\scripts\start.bat" `
  /SC ONLOGON /RL LIMITED /F
```

删除自启：

```powershell
schtasks /Delete /TN "LIS-RSS-Start" /F
```

---

## 7. ChromaDB（可选）

主程序不依赖 ChromaDB 即可启动；未启动时语义检索相关功能会在接口返回中提示 Chroma 不可用，其余功能正常。

需要语义检索时再启动：

```powershell
chroma run --host 127.0.0.1 --port 8000 --path F:\Github\lis-rss-daily\data\vector\chroma
```

验证（Chroma 1.x 使用 v2 心跳接口，v1 会返回 410）：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/api/v2/heartbeat -UseBasicParsing
```

---

## 8. 验证部署

另开一个 PowerShell 窗口执行：

```powershell
# 1. 主程序健康检查（预期 HTTP 200）
Invoke-WebRequest http://localhost:8007 -UseBasicParsing -TimeoutSec 10

# 2. 确认只有一个实例
(Get-NetTCPConnection -LocalPort 8007 -State Listen).Count   # 期望 1

# 3. 确认进程树只有一个
tasklist | findstr node
```

浏览器访问 **http://localhost:8007**，默认账号：

- 用户名：`admin`
- 密码：`yfzjlxy0527`

**登录后立即修改密码。**

---

## 9. 停止与重启

### 停止（必须连子进程一起杀，否则端口不释放）

```powershell
$c = Get-NetTCPConnection -LocalPort 8007 -State Listen -ErrorAction SilentlyContinue
if ($c) {
  taskkill /PID $c[0].OwningProcess /T /F
} else {
  Write-Host "8007 未监听，无需停止"
}
```

### 重启

```powershell
# 1. 停止
$c = Get-NetTCPConnection -LocalPort 8007 -State Listen -ErrorAction SilentlyContinue
if ($c) { taskkill /PID $c[0].OwningProcess /T /F }
Start-Sleep -Seconds 2

# 2. 确认端口已释放
Get-NetTCPConnection -LocalPort 8007 -State Listen -ErrorAction SilentlyContinue

# 3. 启动
Set-Location F:\Github\lis-rss-daily
pnpm run dev
```

### 什么时候必须重启

| 场景 | 操作 |
|------|------|
| 修改 `.env` | 重启主程序 |
| 代码更新 | `git pull` + `pnpm install` + `pnpm run db:migrate` + 重启 |
| 依赖更新 | `pnpm install` + 重启 |
| 应用卡死 | 重启 |
| 仅改 Web 前端 CSS/模板 | `pnpm run build:css` 后刷新页面（视情况重启） |

---

## 10. 查看日志

```powershell
# 实时跟踪应用日志（start.bat 方式启动时）
Get-Content F:\Github\lis-rss-daily\logs\app.log -Tail 100 -Wait

# 仅看最近 100 行
Get-Content F:\Github\lis-rss-daily\logs\app.log -Tail 100
```

`LOG_FILE` 留空时日志只输出到启动窗口的控制台，此时只能看窗口内容。

---

## 11. 常见问题排查

### 11.1 `ERR_MODULE_NOT_FOUND: Cannot find package 'imapflow'`

**原因**：依赖未安装或不完整。

```powershell
pnpm install
```

### 11.2 better-sqlite3 编译失败 / `ERR_DLOPEN_FAILED`

**症状**：`The module 'better_sqlite3.node' was compiled against a different Node.js version`。

**原因**：预编译二进制的 ABI 与当前 Node 版本不匹配（例如下载的是 Node 24 的产物，实际跑 Node 22）。

**解决**：

```powershell
# 1. 删除旧构建产物
Remove-Item -Recurse -Force node_modules\better-sqlite3\build -ErrorAction SilentlyContinue

# 2. 重装
pnpm install

# 3. 验证
node -e "const D=require('better-sqlite3');const db=new D(':memory:');console.log('ok');db.close()"
```

若仍失败，需要本机编译环境（VS 2022 Build Tools + Python 3）：

```powershell
# 安装 VS Build Tools（含 C++ 工作负载）
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"

# 强制源码编译
npx --yes node-gyp rebuild --release --directory=node_modules\better-sqlite3
```

> 升级 Node 大版本后，一律重新执行 `pnpm install`。

### 11.3 `undici` 报 `ReferenceError: File is not defined`

**原因**：Node 18.x 与 `undici@7.x` 不兼容。

**解决**：升级到 Node 24+（`nvm use 24` 或重装），然后重装依赖。

### 11.4 端口 8007 已被占用 / 服务起不来

```powershell
Get-NetTCPConnection -LocalPort 8007 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

有残留实例时按 [第 9 节](#9-停止与重启) 杀掉，**不要**再起第二个实例。

### 11.5 Telegram 报 `Conflict: terminated by other getUpdates request`

**原因**：有多个进程同时轮询同一 Bot token——通常是本机起了两个实例，或本机与远程 Ubuntu 服务器同时在跑。

**解决**：只保留一个实例。确认本机不需要时：

```powershell
$c = Get-NetTCPConnection -LocalPort 8007 -State Listen -ErrorAction SilentlyContinue
if ($c) { taskkill /PID $c[0].OwningProcess /T /F }
```

### 11.6 迁移未执行导致缺表

**症状**：查询报表不存在（如 `user_daily_scores`、`web_sources`）。

```powershell
pnpm run db:migrate
```

---

## 12. 安全建议

1. 登录后立即修改 admin 默认密码
2. `JWT_SECRET`、`LLM_ENCRYPTION_KEY` 使用强随机值
3. 仅在本机使用时绑定 `localhost`；需要局域网访问时，在 Windows 防火墙放行 `8007`：

```powershell
New-NetFirewallRule -DisplayName "LIS-RSS 8007" -Direction Inbound -Protocol TCP -LocalPort 8007 -Action Allow
```

4. 定期备份 `data\rss-tracker.db`

---

## 附录：与 Ubuntu 部署的差异速查

| 项 | Ubuntu (systemd) | Windows 11 |
|----|------------------|-----------|
| 启动命令 | `systemctl start lis-rss` | `scripts\start.bat` 或 `pnpm run dev` |
| 停止 | `systemctl stop lis-rss` | `taskkill /PID <pid> /T /F` |
| 开机自启 | `systemctl enable` | `schtasks /Create ... /SC ONLOGON` |
| 日志 | `journalctl -u lis-rss -f` | `logs\app.log`（`Get-Content -Wait`） |
| 进程守护 | `Restart=always` | 无自动拉起，需手动或计划任务 |
| 端口放行 | `ufw allow 8007/tcp` | `New-NetFirewallRule` |
| 副服务 | chromadb / deepsearch / paper-pdf-api 均为 systemd 服务 | 按需手动启动，本清单只覆盖主程序 |
