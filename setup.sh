#!/bin/bash

set -e

echo "╔═══════════════════════════════════════╗"
echo "║     AI Chat UI - Setup Script         ║"
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

# Install dependencies
echo "📦 Installing dependencies..."
npm run setup

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✓ Created .env from example. Please edit it to add your API keys."
fi

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║     Setup Complete!                   ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "To start the application:"
echo "  npm run dev"
echo ""
echo "Or with Docker:"
echo "  docker-compose up -d"
echo ""
echo "Edit .env to configure your API keys."
