@echo off
REM RSS Literature Tracker - Windows 启动脚本

setlocal enabledelayedexpansion

REM 颜色设置 (Windows 10+)
set "INFO=[INFO]"
set "SUCCESS=[SUCCESS]"
set "WARNING=[WARNING]"
set "ERROR=[ERROR]"

REM 打印消息
:print_info
echo %INFO% %~1
goto :eof

:print_success
echo %SUCCESS% %~1
goto :eof

:print_warning
echo %WARNING% %~1
goto :eof

:print_error
echo %ERROR% %~1
goto :eof

REM 检查命令是否存在
:command_exists
where %1 >nul 2>&1
goto :eof

REM 检查 Node.js
:check_nodejs
call :print_info "检查 Node.js..."
call :command_exists node
if errorlevel 1 (
    call :print_error "Node.js 未安装"
    call :print_info "请访问 https://nodejs.org 下载安装 Node.js 18 或更高版本"
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%v in ('node -v') do set NODE_VERSION=%%v
for /f "tokens=1 delims=." %%v in ("%NODE_VERSION%") do set NODE_MAJOR=%%v

if %NODE_MAJOR% lss 18 (
    call :print_error "Node.js 版本过低 (当前: %NODE_VERSION%，需要: ^=18.0.0)"
    pause
    exit /b 1
)

call :print_success "Node.js 版本: %NODE_VERSION%"
goto :eof

REM 检查 pnpm
:check_pnpm
call :print_info "检查 pnpm..."
call :command_exists pnpm
if errorlevel 1 (
    call :print_warning "pnpm 未安装，正在安装..."
    npm install -g pnpm
)
call :print_success "pnpm 已安装"
goto :eof

REM 检查环境变量文件
:check_env_file
if not exist .env (
    call :print_warning ".env 文件不存在"
    if exist .env.example (
        call :print_info "从 .env.example 复制配置..."
        copy .env.example .env >nul
        call :print_warning "请编辑 .env 文件，添加你的 OPENAI_API_KEY"
        call :print_info "按任意键打开编辑器..."
        pause >nul
        notepad .env
    ) else (
        call :print_error ".env.example 文件不存在，无法创建配置文件"
        pause
        exit /b 1
    )
)
goto :eof

REM 创建必要的目录
:create_directories
call :print_info "创建必要的目录..."
if not exist data\exports mkdir data\exports
if not exist data\vector\chroma mkdir data\vector\chroma
if not exist logs mkdir logs
call :print_success "目录创建完成"
goto :eof

REM 检查 Chroma CLI
:check_chroma
call :print_info "检查 Chroma 服务..."
call :command_exists chroma
if errorlevel 1 (
    call :print_warning "未找到 chroma 命令，无法自动启动 Chroma"
    call :print_info "请先安装: pip install chromadb"
    goto :eof
)
goto :eof

REM 启动 Chroma 服务
:start_chroma
set "CHROMA_HOST=127.0.0.1"
set "CHROMA_PORT=8000"
set "CHROMA_DATA_DIR=data\\vector\\chroma"

for /f %%i in ('powershell -NoProfile -Command "(Test-NetConnection -ComputerName %CHROMA_HOST% -Port %CHROMA_PORT%).TcpTestSucceeded"') do set PORT_OPEN=%%i
if /i "%PORT_OPEN%"=="True" (
    call :print_success "Chroma 已在 %CHROMA_HOST%:%CHROMA_PORT% 运行"
    goto :eof
)

call :print_info "启动 Chroma (%CHROMA_HOST%:%CHROMA_PORT%)..."
start "" /b chroma run --host %CHROMA_HOST% --port %CHROMA_PORT% --path "%CHROMA_DATA_DIR%"
timeout /t 2 /nobreak >nul
goto :eof

REM 安装依赖
:install_dependencies
if not exist node_modules (
    call :print_info "安装项目依赖..."
    call pnpm install
    call :print_success "依赖安装完成"
) else (
    call :print_info "依赖已存在，跳过安装"
)
goto :eof

REM 初始化数据库
:init_database
if not exist data\database.sqlite (
    call :print_info "初始化数据库..."
    call pnpm run db:migrate
    call :print_success "数据库初始化完成"

    set /p FILL_DATA="是否填充示例数据? (y/N): "
    if /i "!FILL_DATA!"=="y" (
        call :print_info "填充示例数据..."
        call pnpm run db:seed
        call :print_success "示例数据填充完成"
    )
) else (
    call :print_info "数据库已存在，跳过初始化"
)
goto :eof

REM 启动应用
:start_app
cls
echo.
echo ===============================================
echo   RSS Literature Tracker
echo   ===============================================
echo   访问地址: http://localhost:3000
echo   默认用户: admin / admin123
echo   ===============================================
echo.
call :print_info "启动应用..."
echo.

call pnpm dev
goto :eof

REM 主函数
:main
echo.
echo ===============================================
echo   RSS Literature Tracker - 启动脚本
echo   ===============================================
echo.

REM 切换到脚本所在目录的父目录
cd /d "%~dp0.."

REM 执行检查
call :check_nodejs
call :check_pnpm
call :check_env_file
call :create_directories
call :install_dependencies
call :init_database
call :check_chroma
call :start_chroma

REM 启动应用
call :start_app

endlocal
