@echo off
setlocal enabledelayedexpansion

echo ╔═══════════════════════════════════════╗
echo ║     AI Chat UI - Setup Script         ║
echo ╚═══════════════════════════════════════╝
echo.

REM Check for Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    echo    Visit: https://nodejs.org/
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node --version') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo ❌ Node.js 18+ is required.
    exit /b 1
)

echo ✓ Node.js found
echo.

REM Install dependencies
echo 📦 Installing dependencies...
call npm run setup

REM Create .env if it doesn't exist
if not exist .env (
    echo 📝 Creating .env file...
    copy .env.example .env
    echo ✓ Created .env from example. Please edit it to add your API keys.
)

echo.
echo ╔═══════════════════════════════════════╗
echo ║     Setup Complete!                   ║
echo ╚═══════════════════════════════════════╝
echo.
echo To start the application:
echo   npm run dev
echo.
echo Or with Docker:
echo   docker-compose up -d
echo.
echo Edit .env to configure your API keys.

pause
