# AI Chat UI - Run Script (PowerShell)
# Works on Windows PowerShell 5.1+ and PowerShell Core 7+

function Show-Banner {
    Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     AI Chat UI - Run Script           ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Test-Node {
    try {
        $version = node --version 2>$null
        if (-not $version) { throw }
        $major = [int]($version -replace "v", "").Split(".")[0]
        if ($major -lt 18) {
            Write-Host "❌ Node.js 18+ is required. Found: $version" -ForegroundColor Red
            exit 1
        }
        Write-Host "✓ Node.js $version found" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "❌ Node.js is not installed. Please install Node.js 18+ first." -ForegroundColor Red
        Write-Host "   Visit: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
}

function Test-NeedsSetup {
    return -not (
        (Test-Path "node_modules") -and
        (Test-Path "frontend\node_modules") -and
        (Test-Path "server\node_modules")
    )
}

function Invoke-Setup {
    Write-Host "📦 Dependencies not found. Running setup first..." -ForegroundColor Yellow
    Write-Host ""
    npm run setup
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Setup failed." -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

function Initialize-EnvFile {
    if (-not (Test-Path ".env")) {
        Write-Host "📝 Creating .env file from example..." -ForegroundColor Yellow
        Copy-Item ".env.example" ".env"
        Write-Host "✓ Created .env - please edit it to add your API keys." -ForegroundColor Green
        Write-Host ""
    }
}

function Start-Application {
    $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress
    Write-Host "🚀 Starting AI Chat UI..." -ForegroundColor Green
    Write-Host "   Local:    http://localhost:5183" -ForegroundColor DarkGray
    Write-Host "   LAN:      http://$lanIp`:5183" -ForegroundColor DarkGray
    Write-Host "   Backend:  http://localhost:3456" -ForegroundColor DarkGray
    Write-Host "   API:      http://localhost:3456/api" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Press Ctrl+C twice to stop." -ForegroundColor DarkGray
    Write-Host ""
    npm run dev
}

# Main
Show-Banner
Test-Node

if (Test-NeedsSetup) {
    Invoke-Setup
}

Initialize-EnvFile
Start-Application
