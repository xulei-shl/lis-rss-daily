@echo off
REM RSS Literature Tracker - Chroma Startup Script
REM This script ensures Chroma is properly started before continuing

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
set "CHROMA_LOG_DIR=%CD%\logs"
set "CHROMA_MAX_WAIT=30"

REM Create necessary directories
echo [INFO] Creating necessary directories...
if not exist "data\vector\chroma" mkdir "data\vector\chroma"
if not exist "logs" mkdir "logs"
echo [SUCCESS] Directory check completed

REM Check if chroma command is available
echo [INFO] Checking chroma command...
where chroma >nul 2>&1
if errorlevel 1 (
    echo [WARNING] chroma command not found
    echo [INFO] Vector search will be disabled
    echo [INFO] To enable: pip install chromadb
    goto :script_end
)
echo [SUCCESS] chroma command available

REM Check if Chroma is already running
echo [INFO] Checking if Chroma is already running...
powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $tcp=New-Object System.Net.Sockets.TcpClient; try{ $tcp.Connect('%CHROMA_HOST%',%CHROMA_PORT%); $tcp.Close(); exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Verifying existing Chroma instance...
    powershell -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://%CHROMA_HOST%:%CHROMA_PORT%/api/v1/heartbeat' -UseBasicParsing -TimeoutSec 3; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        echo [SUCCESS] Chroma is already running and healthy
        goto :script_end
    ) else (
        echo [WARNING] Port %CHROMA_PORT% is in use but Chroma is not responding
        echo [INFO] Please check if another service is using port %CHROMA_PORT%
        goto :script_end
    )
)

REM Start Chroma in background (hidden window)
echo [INFO] Starting Chroma vector database service...
start /B "" cmd /c "chroma run --host %CHROMA_HOST% --port %CHROMA_PORT% --path \"%CHROMA_DATA_DIR%\" > \"%CHROMA_LOG_DIR%\chroma.log\" 2>&1"

REM Wait for Chroma to be ready with health check
echo [INFO] Waiting for Chroma to be ready (max %CHROMA_MAX_WAIT% seconds)...

set /a WAIT_COUNT=0
:wait_loop
if %WAIT_COUNT% geq %CHROMA_MAX_WAIT% (
    echo [ERROR] Chroma failed to start within %CHROMA_MAX_WAIT% seconds
    echo [INFO] Check logs at: %CHROMA_LOG_DIR%\chroma.log
    echo [WARNING] Vector search will be disabled
    goto :script_end
)

REM Check heartbeat endpoint
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://%CHROMA_HOST%:%CHROMA_PORT%/api/v1/heartbeat' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [SUCCESS] Chroma is ready at http://%CHROMA_HOST%:%CHROMA_PORT%
    goto :script_end
)

REM Wait 1 second and retry
set /a WAIT_COUNT+=1
set /a "REMAINING=%CHROMA_MAX_WAIT%-%WAIT_COUNT%"
set /p "=[INFO] Waiting... (!REMAINING!s remaining) "<nul
timeout /t 1 /nobreak >nul
goto :wait_loop

:script_end
echo.
endlocal
