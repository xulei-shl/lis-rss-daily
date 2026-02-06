@echo off
REM RSS Literature Tracker - Application Startup Script

setlocal enabledelayedexpansion

REM Switch to parent directory of the script
cd /d "%~dp0.."

echo.
echo ===============================================
echo   RSS Literature Tracker - Application Startup
echo ===============================================
echo.

REM Check Node.js
echo [INFO] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not installed
    echo [INFO] Please visit https://nodejs.org to download and install Node.js 18 or higher
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%i in ('node -v 2^>nul') do set "NODE_VER=%%i"
for /f "tokens=1 delims=." %%i in ("%NODE_VER:v=%") do set "NODE_MAJOR=%%i"

if "%NODE_MAJOR%"=="" set NODE_MAJOR=0
if %NODE_MAJOR% lss 18 (
    echo [ERROR] Node.js version is too old, requires version 18 or higher
    pause
    exit /b 1
)

for /f "tokens=* delims=" %%i in ('node -v 2^>nul') do set "NODE_VERSION=%%i"
echo [SUCCESS] Node.js version: %NODE_VERSION%

REM Check pnpm
echo [INFO] Checking pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [WARNING] pnpm not installed, installing...
    npm install -g pnpm
)
echo [SUCCESS] pnpm is installed

REM Create necessary directories
echo [INFO] Creating necessary directories...
if not exist "data\exports" mkdir "data\exports"
if not exist "logs" mkdir "logs"
echo [SUCCESS] Directory creation completed

REM Install dependencies
if not exist node_modules (
    echo [INFO] Installing project dependencies...
    call pnpm install
    echo [SUCCESS] Dependencies installed
) else (
    echo [INFO] Dependencies already exist, skipping
)

REM Initialize database
if not exist "data\rss-tracker.db" (
    echo [INFO] Initializing database...
    call pnpm run db:migrate
    if errorlevel 1 (
        echo [ERROR] Database migration failed, please check logs
        pause
        exit /b 1
    )
    echo [SUCCESS] Database initialization completed
) else (
    echo [INFO] Database already exists, skipping initialization
)

REM Start application
cls
echo.
echo ===============================================
echo   RSS Literature Tracker
echo ===============================================
echo   Access URL: http://localhost:3000
echo   Default User: admin / admin123
echo   Chroma API: http://127.0.0.1:8000
echo ===============================================
echo.
echo [INFO] Starting development server...
echo.

call pnpm dev

endlocal
