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
