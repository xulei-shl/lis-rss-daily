@echo off
REM RSS Literature Tracker - Chroma Startup Script

setlocal enabledelayedexpansion

REM Switch to parent directory of the script
cd /d "%~dp0.."

echo.
echo ===============================================
echo   RSS Literature Tracker - Chroma Startup
echo ===============================================
echo.

REM Set Chroma environment variables
set "CHROMA_HOST=127.0.0.1"
set "CHROMA_PORT=8000"
set "CHROMA_DATA_DIR=%CD%\data\vector\chroma"

REM Create necessary directories
echo [INFO] Creating necessary directories...
if not exist "data\vector\chroma" mkdir "data\vector\chroma"
echo [SUCCESS] Directory check completed

REM Check if chroma command is available
echo [INFO] Checking chroma command...
where chroma >nul 2>&1
if errorlevel 1 (
    echo [WARNING] chroma command not found
    echo [INFO] Please install: pip install chromadb
    echo [INFO] Or manually start Chroma and continue
    goto :after_chroma
) else (
    echo [SUCCESS] chroma command available
)

REM Check if port is already in use
powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $tcp=New-Object System.Net.Sockets.TcpClient; try{ $tcp.Connect('%CHROMA_HOST%',%CHROMA_PORT%); $tcp.Close(); exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [SUCCESS] Chroma is already running at %CHROMA_HOST%:%CHROMA_PORT%
    goto :after_chroma
)

echo [INFO] Starting Chroma vector database service...
start "Chroma Server" cmd /c "title Chroma Server && chroma run --host %CHROMA_HOST% --port %CHROMA_PORT% --path \"%CHROMA_DATA_DIR%\" && pause"

echo [INFO] Waiting for Chroma to start...
timeout /t 5 /nobreak >nul

:after_chroma
echo.
endlocal
