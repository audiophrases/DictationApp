@echo off
setlocal
cd /d "%~dp0"
title Dictation Time (local)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found.
  echo Download it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Building the app...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed - see the errors above.
  pause
  exit /b 1
)

rem A previous instance may still be holding the port (its window left open,
rem or a crash) - free it so this launch always starts a fresh server.
echo Freeing port 4173 if a previous instance is still running...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4173" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>nul
timeout /t 1 /nobreak >nul

echo.
echo Starting Dictation Time (production build) with neural voices at http://127.0.0.1:4173
echo Keep this window open while using the app. Close it to stop.
echo.

start /b "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:4173"

node server\serve.js
