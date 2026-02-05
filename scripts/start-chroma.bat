@echo off
REM RSS Literature Tracker - Chroma 启动脚本

setlocal enabledelayedexpansion

REM 切换到脚本所在目录的父目录
cd /d "%~dp0.."

echo.
echo ===============================================
echo   RSS Literature Tracker - Chroma 启动

echo   ===============================================
echo.

REM 设置 Chroma 环境变量
set "CHROMA_HOST=127.0.0.1"
set "CHROMA_PORT=8000"
set "CHROMA_DATA_DIR=%CD%\data\vector\chroma"

REM 创建必要目录
echo [INFO] 创建必要的目录...
if not exist "data\vector\chroma" mkdir "data\vector\chroma"
echo [SUCCESS] 目录检查完成

REM 检查 chroma 命令是否可用
echo [INFO] 检查 chroma 命令...
where chroma >nul 2>&1
if errorlevel 1 (
    echo [WARNING] 未找到 chroma 命令
    echo [INFO] 请先安装: pip install chromadb
    echo [INFO] 或手动启动 Chroma 后继续
    goto :after_chroma
) else (
    echo [SUCCESS] chroma 命令可用
)

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
endlocal
