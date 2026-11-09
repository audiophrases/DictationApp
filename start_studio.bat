@echo off
setlocal
cd /d "%~dp0"
title Dictation Studio (local)
rem The teacher's local copy of Dictation, with Listening Studio voices.
rem  1. Starts PinPlay's Listening Studio (Qwen3 voices on this computer) in
rem     its own minimised window, unless it is already running. It is looked
rem     for next to this folder (..\pinplay), or where PINPLAY_DIR points.
rem  2. Starts Dictation locally (start_local.bat) on the teacher's page.
rem The page reaches the studio through this computer's Dictation server
rem (server/listeningStudio.js), so nothing in PinPlay has to change.
rem Without the studio, the page still has Microsoft voices and human
rem recording sessions.

set "STUDIO_URL=http://127.0.0.1:8790/"
if not defined PINPLAY_DIR set "PINPLAY_DIR=%~dp0..\pinplay"
set "LS=%PINPLAY_DIR%\listening-studio"

call :studio_up
if not errorlevel 1 (
  echo Listening Studio is already running.
  goto app
)
if not exist "%LS%\server.py" (
  echo Listening Studio was not found in:
  echo   %LS%
  echo Set PINPLAY_DIR to the PinPlay folder to use its voices. Starting Dictation without them.
  goto app
)

rem The folder PinPlay's own launcher chose for the engine (studio-home.txt,
rem one per computer), else its usual folder on D:.
set "HOME_DIR="
if exist "%LS%\studio-home.txt" set /p HOME_DIR=<"%LS%\studio-home.txt"
if not defined HOME_DIR set "HOME_DIR=D:\Admin\pinplay listening tts audio production"
set "PY=%HOME_DIR%\qwen3\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Listening Studio is not set up on this computer yet.
  echo Its own launcher sets it up once ^(about 2 GB, 10 to 20 minutes^), then opens its page.
  call "%LS%\PinPlay Listening Studio.bat"
  goto app
)
if not exist "%HOME_DIR%\studio-data" mkdir "%HOME_DIR%\studio-data"
rem server.py reads its folder from this.
set "PINPLAY_STUDIO_HOME=%HOME_DIR%"
echo Starting Listening Studio in its own minimised window ^(close that window to stop the voices^)...
start "PinPlay Listening Studio (running - close to stop)" /min cmd /c ""%PY%" "%LS%\server.py" > "%HOME_DIR%\studio-data\studio-log.txt" 2>&1"

:app
rem The Dictation page keeps looking for the studio while it starts up.
call "%~dp0start_local.bat" create/
exit /b %errorlevel%


rem Exit code 0 when Listening Studio answers.
:studio_up
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%STUDIO_URL%api/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%
