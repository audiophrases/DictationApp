@echo off
setlocal EnableDelayedExpansion
title Deploy Dictation Time
pushd "%~dp0"
if errorlevel 1 exit /b 1

rem Ships everything, in the order that can't leave the live site half-updated:
rem the assignment server first, then the website, so the website never calls
rem a server route that doesn't exist yet.
rem
rem   deploy.bat           test, commit, deploy the server, publish the website
rem   deploy.bat --check   only pull, test and build; publishes nothing

set "CHECK_ONLY="
if /i "%~1"=="--check" set "CHECK_ONLY=1"

where git >nul 2>nul
if errorlevel 1 (
  echo Git is required. Install it from https://git-scm.com and try again.
  goto failed
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and try again.
  goto failed
)

for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "!BRANCH!"=="main" (
  echo You are on branch "!BRANCH!". Switch to main before deploying.
  goto failed
)

echo [1/6] Getting the latest version from GitHub...
rem --autostash keeps any changes you haven't saved yet; they are committed in step 3.
git pull --rebase --autostash origin main
if errorlevel 1 (
  echo.
  echo Your changes clash with changes on GitHub. Resolve them, then run this again.
  goto failed
)

echo.
echo [2/6] Installing packages and checking everything works...
call npm install --no-audit --no-fund
if errorlevel 1 goto failed
call npm test
if errorlevel 1 (
  echo.
  echo A test failed, so nothing was published.
  goto failed
)
call npm run build
if errorlevel 1 goto failed

if defined CHECK_ONLY (
  echo.
  echo All checks passed. Nothing was published ^(--check^).
  goto done
)

echo.
echo [3/6] Saving your changes...
set "CHANGES="
for /f "delims=" %%c in ('git status --porcelain') do set "CHANGES=1"
if defined CHANGES (
  git status --short
  echo.
  set "MESSAGE="
  set /p "MESSAGE=Describe what changed, in a few words (leave empty to cancel): "
  if not defined MESSAGE (
    echo Cancelled. Nothing was published.
    goto failed
  )
  git add -A
  git commit -q -m "!MESSAGE!"
  if errorlevel 1 goto failed
) else (
  echo No unsaved changes.
)

echo.
echo [4/6] Publishing the assignment server to Cloudflare...
echo Complete Cloudflare sign-in in your browser if prompted.
call npm run deploy:assignments
if errorlevel 1 (
  echo.
  echo The assignment server was not deployed, so the website was not published either.
  echo If Cloudflare sign-in failed, run: npm run cloudflare:login
  goto failed
)

echo.
echo [5/6] Publishing the website to GitHub Pages...
git push origin main
if errorlevel 1 goto failed
echo The website updates in about a minute.
echo Open pages may keep the old version for up to 10 minutes; reload to see it.

echo.
echo [6/6] Windows portable pack
echo The pack can't update itself. Rebuild it only if students use it.
choice /c YN /n /m "Rebuild the Windows portable pack now? [Y/N] "
if errorlevel 2 goto deployed
call npm run pack:win
if errorlevel 1 goto failed
echo Hand out the new pack\DictationTime-Windows.zip.

:deployed
echo.
echo Deployment complete.

:done
popd
if /i not "%~2"=="--no-pause" if /i not "%~1"=="--no-pause" pause
exit /b 0

:failed
echo.
echo Deployment did not complete. See the message above.
popd
if /i not "%~2"=="--no-pause" if /i not "%~1"=="--no-pause" pause
exit /b 1
