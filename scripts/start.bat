@echo off
REM RSS Literature Tracker - Windows Startup Script

setlocal enabledelayedexpansion

REM Switch to parent directory of the script
cd /d "%~dp0.."

echo.
echo ===============================================
echo   RSS Literature Tracker - Startup Script
echo ===============================================
echo.

REM Start Chroma first (non-blocking)
call "%~dp0start-chroma.bat"

REM Start the application
call "%~dp0start-app.bat"

endlocal
