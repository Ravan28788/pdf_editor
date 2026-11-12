@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================================
echo   JadePDF Editor - Standalone Windows .EXE Builder
echo   Produces a single standalone .EXE (end-users do NOT need Node.js!)
echo ============================================================================
echo.

if /i "%~1"=="--mirror" (
    echo [Info] Mirror mode enabled for Electron and Electron-Builder binaries.
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
)

if defined NODE_OPTIONS (
    set "NODE_OPTIONS=%NODE_OPTIONS% --dns-result-order=ipv4first"
) else (
    set "NODE_OPTIONS=--dns-result-order=ipv4first"
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [Info] Node.js is not installed system-wide.
    echo [Info] Downloading portable Node.js locally into .build-node\ ^(no system install^)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference='Stop';" ^
      "$dir=Join-Path '%~dp0' '.build-node';" ^
      "New-Item -ItemType Directory -Force -Path $dir | Out-Null;" ^
      "$sums=(Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt').Content;" ^
      "$line=($sums -split \"`n\" | Where-Object { $_ -match 'node-v20\.\d+\.\d+-win-x64\.zip$' } | Select-Object -First 1);" ^
      "if (-not $line) { throw 'Could not locate win-x64 portable Node.js zip'; }" ^
      "$parts=$line.Trim() -split '\s+';" ^
      "$expectedHash=$parts[0]; $fileName=$parts[1];" ^
      "$zipPath=Join-Path $dir $fileName;" ^
      "if (-not (Test-Path (Join-Path $dir 'node-ready.txt'))) {" ^
      "  Write-Host \"Downloading $fileName...\";" ^
      "  Invoke-WebRequest -UseBasicParsing \"https://nodejs.org/dist/latest-v20.x/$fileName\" -OutFile $zipPath;" ^
      "  $actualHash=(Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower();" ^
      "  if ($actualHash -ne $expectedHash.ToLower()) { Remove-Item $zipPath -Force; throw 'SHA-256 verification failed!'; }" ^
      "  Expand-Archive -Path $zipPath -DestinationPath $dir -Force;" ^
      "  Remove-Item $zipPath -Force;" ^
      "  $extracted=Get-ChildItem -Directory $dir | Where-Object { $_.Name -like 'node-v20*' } | Select-Object -First 1;" ^
      "  if (-not $extracted) { throw 'Extracted Node.js folder not found'; }" ^
      "  Set-Content -Path (Join-Path $dir 'node-ready.txt') -Value $extracted.FullName;" ^
      "}"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to download portable Node.js. Check internet access and retry.
        pause
        exit /b 1
    )
    set /p PORTABLE_NODE_DIR=<"%~dp0.build-node\node-ready.txt"
    set "PATH=!PORTABLE_NODE_DIR!;%PATH%"
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [1/5] Using Node.js %NODE_VER%

echo [2/5] Installing build dependencies...
echo       First run downloads ~150-200 MB ^(including Electron runtime from GitHub^).
echo       Showing live logs below. ^(If GitHub is slow, press Ctrl+C and run: build_windows.bat --mirror^)
:run_install
set "DEBUG=@electron/get*"
call npm install --foreground-scripts --loglevel info --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000
set "INSTALL_ERR=%errorlevel%"
set "DEBUG="
if %INSTALL_ERR% neq 0 (
    echo.
    echo [ERROR] npm install failed ^(code %INSTALL_ERR%^).
    if not defined ELECTRON_MIRROR (
        set "RETRY_MIRROR="
        set /p RETRY_MIRROR=GitHub download may be slow or blocked. Retry via npmmirror CDN? [Y/N]: 
        if /i "!RETRY_MIRROR!"=="Y" (
            set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
            set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
            goto :run_install
        )
    )
    echo         Tip: You can also build the .EXE in the cloud via .github\workflows\build-windows.yml
    pause
    exit /b 1
)

echo [3/5] Preparing PDF.js worker, CMaps, and standard fonts...
call npm run prepare:assets
if %errorlevel% neq 0 (
    echo [ERROR] Failed to prepare PDF.js assets.
    pause
    exit /b 1
)

echo [4/5] Running TypeScript verification and Vite production build...
call npm run typecheck
if %errorlevel% neq 0 (
    echo [ERROR] TypeScript typecheck failed.
    pause
    exit /b 1
)

call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Vite build failed.
    pause
    exit /b 1
)

echo [5/5] Packaging standalone Windows Installer + Portable .EXE...
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
set "DEBUG=@electron/get*"
call npx electron-builder --win --publish never
set "BUILD_ERR=%errorlevel%"
set "DEBUG="
if %BUILD_ERR% neq 0 (
    echo [ERROR] Electron Builder failed ^(code %BUILD_ERR%^).
    echo         If binary download timed out, try: build_windows.bat --mirror
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo   BUILD COMPLETE!
echo   Your standalone Windows .EXE files are inside: %~dp0release\
echo   End-users can run these .EXE files directly with NO Node.js installed.
echo ============================================================================
if exist "%~dp0release" start "" "%~dp0release"
pause
