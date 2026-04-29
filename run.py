#!/usr/bin/env python3
"""
AI Chat UI - Universal Run Script
Works on Windows, macOS, and Linux.
"""

import os
import sys
import subprocess
import shutil
import platform


def print_banner():
    print("╔═══════════════════════════════════════╗")
    print("║     AI Chat UI - Run Script           ║")
    print("╚═══════════════════════════════════════╝")
    print()


def check_node():
    """Check if Node.js 18+ is installed."""
    node_path = shutil.which("node")
    if not node_path:
        print("❌ Node.js is not installed. Please install Node.js 18+ first.")
        print("   Visit: https://nodejs.org/")
        sys.exit(1)

    result = subprocess.run(["node", "--version"], capture_output=True, text=True)
    version_str = result.stdout.strip().lstrip("v")
    major = int(version_str.split(".")[0])

    if major < 18:
        print(f"❌ Node.js 18+ is required. Found: {version_str}")
        sys.exit(1)

    print(f"✓ Node.js {version_str} found")
    print()


def needs_setup():
    """Check if dependencies need to be installed."""
    return (
        not os.path.isdir("node_modules")
        or not os.path.isdir("frontend/node_modules")
        or not os.path.isdir("server/node_modules")
    )


def run_setup():
    """Run npm install for all packages."""
    print("📦 Dependencies not found. Running setup first...")
    print()
    result = subprocess.run(["npm", "run", "setup"], shell=(platform.system() == "Windows"))
    if result.returncode != 0:
        print("❌ Setup failed.")
        sys.exit(1)
    print()


def ensure_env():
    """Create .env from example if it doesn't exist."""
    if not os.path.exists(".env"):
        if os.path.exists(".env.example"):
            print("📝 Creating .env file from example...")
            shutil.copy(".env.example", ".env")
            print("✓ Created .env - please edit it to add your API keys.")
            print()


def get_lan_ip():
    """Get the LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unknown"

def start_app():
    """Start the development servers."""
    lan_ip = get_lan_ip()
    print("🚀 Starting AI Chat UI...")
    print(f"   Local:    http://localhost:5183")
    print(f"   LAN:      http://{lan_ip}:5183")
    print("   Backend:  http://localhost:3456")
    print("   API:      http://localhost:3456/api")
    print()
    print("Press Ctrl+C to stop.")
    print()

    try:
        subprocess.run(["npm", "run", "dev"], shell=(platform.system() == "Windows"))
    except KeyboardInterrupt:
        print()
        print("👋 Stopping AI Chat UI...")
        sys.exit(0)


def main():
    print_banner()
    check_node()

    if needs_setup():
        run_setup()

    ensure_env()
    start_app()


if __name__ == "__main__":
    main()
