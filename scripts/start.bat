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

REM 先启动 Chroma（失败不阻断应用启动）
call "%~dp0start-chroma.bat"

REM 启动应用
call "%~dp0start-app.bat"

endlocal
