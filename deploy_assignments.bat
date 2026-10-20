@echo off
setlocal
title Deploy Dictation assignments
pushd "%~dp0"
if errorlevel 1 exit /b 1

echo Deploying the live Dictation assignment server to Cloudflare.
echo Worker: dictation-api
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and try again.
  goto failed
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js and try again.
  goto failed
)

node -e "process.exit(require('./node_modules/wrangler/package.json').version === require('./package.json').devDependencies.wrangler ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Installing the project's deployment tools...
  call npm ci --include=dev
  if errorlevel 1 goto failed
)

echo Checking notebook segmentation...
call npm run test:notebook
if errorlevel 1 goto failed

echo Checking the assignment server...
call npm run test:worker
if errorlevel 1 goto failed

echo.
echo Publishing the assignment server...
echo Complete Cloudflare sign-in in your browser if prompted.
call npm run deploy:assignments
if errorlevel 1 goto failed

echo.
echo Deployment complete. Refresh the app and create your assignment again.
echo The website is published separately by pushing to main on GitHub.
popd
if /i not "%~1"=="--no-pause" pause
exit /b 0

:failed
echo.
echo Deployment did not complete. See the error above.
echo If Cloudflare sign-in failed, run npm run cloudflare:login and try again.
popd
if /i not "%~1"=="--no-pause" pause
exit /b 1
