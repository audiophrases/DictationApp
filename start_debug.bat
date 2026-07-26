@echo off
echo Looking for processes on port 5173...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173') do (
    if "%%a" NEQ "0" (
        echo Killing process ID %%a...
        taskkill /F /PID %%a 2>nul
    )
)

echo.
echo Starting Dictation App in debug mode and opening browser...
cd /d "c:\Users\Admin\DictationApp"
npm run dev -- --debug --open
pause
