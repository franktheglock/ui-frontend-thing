#!/bin/bash

set -e

echo "╔═══════════════════════════════════════╗"
echo "║     AI Chat UI - Run Script           ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Found: $(node -v)"
    exit 1
fi

echo "✓ Node.js $(node -v) found"
echo ""

# Check if dependencies are installed
NEEDS_SETUP=0

if [ ! -d "node_modules" ] || [ ! -d "frontend/node_modules" ] || [ ! -d "server/node_modules" ]; then
    NEEDS_SETUP=1
fi

if [ "$NEEDS_SETUP" -eq 1 ]; then
    echo "📦 Dependencies not found. Running setup first..."
    echo ""
    npm run setup
    echo ""
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from example..."
    cp .env.example .env
    echo "✓ Created .env - please edit it to add your API keys."
    echo ""
fi

# Get LAN IP
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1 || echo "unknown")

# Start the app
echo "🚀 Starting AI Chat UI..."
echo "   Local:    http://localhost:5183"
echo "   LAN:      http://$LAN_IP:5183"
echo "   Backend:  http://localhost:3456"
echo "   API:      http://localhost:3456/api"
echo ""
echo "Press Ctrl+C to stop."
echo ""

npm run dev
