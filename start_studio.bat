@echo off
setlocal
cd /d "%~dp0"
title Dictation Studio (local)
rem The teacher's local copy of Dictation, with Listening Studio voices.
rem  1. Starts PinPlay's Listening Studio (Qwen3 voices on this computer) in
rem     its own minimised window, unless it is already running.
rem  2. Starts Dictation locally (start_local.bat) on the teacher's page.
rem The page reaches the studio through this computer's Dictation server
rem (server/listeningStudio.js), so nothing in PinPlay has to change.
rem Without the studio, the page still has Microsoft voices and human
rem recording sessions.
rem
rem PinPlay can be anywhere, on another drive too. It is looked for in this
rem order: PINPLAY_DIR; the folder remembered in pinplay-folder.txt (next to
rem this file); the desktop icon PinPlay's own launcher makes; ..\pinplay; a
rem pinplay folder in the user's folders or at the top of any drive. If it is
rem still not found, the teacher is asked once and the answer is remembered.
rem   start_studio.bat --where   only says where PinPlay was found.

set "STUDIO_URL=http://127.0.0.1:8790/"
set "FOLDER_FILE=%~dp0pinplay-folder.txt"
set "HERE=%~dp0"

if /i "%~1"=="--where" (
  call :find_studio
  goto where
)

call :studio_up
if not errorlevel 1 (
  echo Listening Studio is already running.
  goto app
)

call :find_studio
if not defined LS (
  echo Starting Dictation without Listening Studio voices.
  goto app
)
echo Listening Studio: %LS%

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

:where
if defined LS (
  echo Listening Studio: %LS%
  exit /b 0
)
echo Listening Studio was not found.
exit /b 1


rem ---------------------------------------------------------------- helpers

rem Exit code 0 when Listening Studio answers.
:studio_up
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%STUDIO_URL%api/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

rem Sets LS to the listening-studio folder, or leaves it empty.
:find_studio
set "LS="
if defined PINPLAY_DIR call :try_folder "%PINPLAY_DIR%"
if defined LS exit /b 0
set "SAVED="
if exist "%FOLDER_FILE%" set /p SAVED=<"%FOLDER_FILE%"
if defined SAVED call :try_folder "%SAVED%"
if defined LS exit /b 0
echo Looking for PinPlay's Listening Studio on this computer...
set "FOUND="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$ErrorActionPreference = 'SilentlyContinue'; $c = New-Object System.Collections.Generic.List[string]; $w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))) { if ($d) { $l = Join-Path $d 'PinPlay Listening Studio.lnk'; if (Test-Path -LiteralPath $l) { $c.Add((Split-Path -Parent $w.CreateShortcut($l).TargetPath)) } } }; $c.Add((Join-Path $env:HERE '..\pinplay')); foreach ($s in @('pinplay', 'Documents\pinplay', 'Documents\GitHub\pinplay', 'Desktop\pinplay', 'source\repos\pinplay')) { $c.Add((Join-Path $env:USERPROFILE $s)) }; foreach ($r in [IO.DriveInfo]::GetDrives()) { if ($r.DriveType -eq 'Fixed' -and $r.IsReady) { foreach ($s in @('pinplay', ('Users\' + $env:USERNAME + '\pinplay'), 'Admin\pinplay')) { $c.Add((Join-Path $r.RootDirectory.FullName $s)) } } }; foreach ($p in $c) { if ($p -and ((Test-Path -LiteralPath (Join-Path $p 'listening-studio\server.py')) -or (Test-Path -LiteralPath (Join-Path $p 'server.py')))) { [IO.Path]::GetFullPath($p); break } }"`) do set "FOUND=%%P"
if defined FOUND call :try_folder "%FOUND%"
if not defined LS call :ask_folder
if not defined LS exit /b 0
> "%FOLDER_FILE%" echo %LS%
exit /b 0

rem The PinPlay folder, or its listening-studio folder: sets LS if it is there.
:try_folder
set "CAND=%~1"
if not defined CAND exit /b 1
if "%CAND:~-1%"=="\" set "CAND=%CAND:~0,-1%"
if exist "%CAND%\listening-studio\server.py" (
  set "LS=%CAND%\listening-studio"
  exit /b 0
)
if exist "%CAND%\server.py" if exist "%CAND%\engine\" (
  set "LS=%CAND%"
  exit /b 0
)
exit /b 1

rem Asks the teacher where PinPlay is (dragging the folder here types its path).
:ask_folder
echo.
echo  Listening Studio was not found on this computer.
echo  Drag the PinPlay folder (the one with listening-studio inside) onto this
echo  window, or type its path, then press Enter. It is remembered next time.
echo  Just press Enter to carry on without Listening Studio voices.
:ask_again
set "ANSWER="
set /p "ANSWER= PinPlay folder: "
if not defined ANSWER exit /b 0
set "ANSWER=%ANSWER:"=%"
call :try_folder "%ANSWER%"
if defined LS exit /b 0
echo  Listening Studio is not in that folder. Try again, or just press Enter.
goto ask_again
