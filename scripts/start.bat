@echo off
REM RSS Literature Tracker - Windows 启动脚本

setlocal enabledelayedexpansion

REM 切换到脚本所在目录的父目录
cd /d "%~dp0.."

echo.
echo ===============================================
echo   RSS Literature Tracker - 启动脚本
echo   ===============================================
echo.

REM 检查 Node.js
echo [INFO] 检查 Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 未安装
    echo [INFO] 请访问 https://nodejs.org 下载安装 Node.js 18 或更高版本
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%i in ('node -v 2^>nul') do set "NODE_VER=%%i"
for /f "tokens=1 delims=." %%i in ("%NODE_VER:v=%") do set "NODE_MAJOR=%%i"

if "%NODE_MAJOR%"=="" set NODE_MAJOR=0
if %NODE_MAJOR% lss 18 (
    echo [ERROR] Node.js 版本过低，需要 18 或更高版本
    pause
    exit /b 1
)

for /f "tokens=* delims=" %%i in ('node -v 2^>nul') do set "NODE_VERSION=%%i"
echo [SUCCESS] Node.js 版本: %NODE_VERSION%

REM 检查 pnpm
echo [INFO] 检查 pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [WARNING] pnpm 未安装，正在安装...
    npm install -g pnpm
)
echo [SUCCESS] pnpm 已安装

REM 创建必要的目录
echo [INFO] 创建必要的目录...
if not exist "data\exports" mkdir "data\exports"
if not exist "data\vector\chroma" mkdir "data\vector\chroma"
if not exist "logs" mkdir "logs"
echo [SUCCESS] 目录创建完成

REM 安装依赖
if not exist node_modules (
    echo [INFO] 安装项目依赖...
    call pnpm install
    echo [SUCCESS] 依赖安装完成
) else (
    echo [INFO] 依赖已存在，跳过安装
)

REM 初始化数据库
if not exist "data\rss-tracker.db" (
    echo [INFO] 初始化数据库...
    call pnpm run db:migrate
    if errorlevel 1 (
        echo [ERROR] 数据库迁移失败，请检查日志
        pause
        exit /b 1
    )
    echo [SUCCESS] 数据库初始化完成
) else (
    echo [INFO] 数据库已存在，跳过初始化
)

REM 检查并启动 Chroma
echo [INFO] 检查 Chroma 服务...

REM 设置 Chroma 环境变量
set "CHROMA_HOST=127.0.0.1"
set "CHROMA_PORT=8000"
set "CHROMA_DATA_DIR=%CD%\data\vector\chroma"

REM 检查 chroma 命令是否可用
where chroma >nul 2>&1
if errorlevel 1 (
    echo [WARNING] 未找到 chroma 命令
    echo [INFO] 请安装: pip install chromadb
    echo [INFO] 或手动启动 Chroma 后继续
) else (
    echo [SUCCESS] Chroma CLI 已安装
    goto :start_chroma
)

goto :after_chroma

:start_chroma
REM 检查端口是否已被占用
powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $tcp=New-Object System.Net.Sockets.TcpClient; try{ $tcp.Connect('%CHROMA_HOST%',%CHROMA_PORT%); $tcp.Close(); exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [SUCCESS] Chroma 已在 %CHROMA_HOST%:%CHROMA_PORT% 运行
    goto :after_chroma
)

echo [INFO] 启动 Chroma 向量数据库服务...
start "Chroma Server" cmd /c "title Chroma Server && chroma run --host %CHROMA_HOST% --port %CHROMA_PORT% --path \"%CHROMA_DATA_DIR%\" && pause"
echo [INFO] 等待 Chroma 启动...
timeout /t 5 /nobreak >nul

:after_chroma
echo.

REM 启动应用
cls
echo.
echo ===============================================
echo   RSS Literature Tracker
echo   ===============================================
echo   访问地址: http://localhost:3000
echo   默认用户: admin / admin123
echo   Chroma API: http://127.0.0.1:8000
echo   ===============================================
echo.
echo [INFO] 启动开发服务器...
echo.

call pnpm dev

endlocal
