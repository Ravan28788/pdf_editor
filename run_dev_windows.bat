@echo off
setlocal
cd /d "%~dp0"

if defined NODE_OPTIONS (
    set "NODE_OPTIONS=%NODE_OPTIONS% --dns-result-order=ipv4first"
) else (
    set "NODE_OPTIONS=--dns-result-order=ipv4first"
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required. Install from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing dependencies for first run...
    set "DEBUG=@electron/get*"
    call npm install --foreground-scripts --loglevel info --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000
    set "DEBUG="
)

call npm run prepare:assets
call npm run electron:dev
pause
