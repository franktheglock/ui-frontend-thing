@echo off
setlocal enabledelayedexpansion

echo ╔═══════════════════════════════════════╗
echo ║     AI Chat UI - Run Script           ║
echo ╚═══════════════════════════════════════╝
echo.

REM Check for Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    echo    Visit: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node --version') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo ❌ Node.js 18+ is required.
    pause
    exit /b 1
)

echo ✓ Node.js found
echo.

REM Check if dependencies are installed
set NEEDS_SETUP=0

if not exist "node_modules" (
    set NEEDS_SETUP=1
) else (
    if not exist "frontend\node_modules" set NEEDS_SETUP=1
    if not exist "server\node_modules" set NEEDS_SETUP=1
)

if %NEEDS_SETUP%==1 (
    echo 📦 Dependencies not found. Running setup first...
    echo.
    call npm run setup
    if errorlevel 1 (
        echo ❌ Setup failed.
        pause
        exit /b 1
    )
    echo.
)

REM Create .env if it doesn't exist
if not exist .env (
    echo 📝 Creating .env file from example...
    copy .env.example .env >nul
    echo ✓ Created .env - please edit it to add your API keys.
    echo.
)

REM Get LAN IP
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress"`) do set LAN_IP=%%a

REM Start the app
echo 🚀 Starting AI Chat UI...
echo    Local:    http://localhost:5183
echo    LAN:      http://%LAN_IP%:5183
echo    Backend:  http://localhost:3456
echo    API:      http://localhost:3456/api
echo.
echo Press Ctrl+C twice to stop.
echo.

npm run dev

pause
