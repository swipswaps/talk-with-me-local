#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "=== [1/6] Reclaiming Ports & Cleaning Stale PIDs ==="
if command -v fuser &>/dev/null; then
    fuser -k 8000/tcp 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true
else
    echo "[INFO] fuser not found. Skipping automatic port cleanup."
fi

echo "=== [2/6] Checking System Prerequisites ==="
if command -v dnf &>/dev/null; then
    echo "DNF detected. Installing build tools..."
    sudo dnf install -y python3-devel python3-pip curl gcc gcc-c++ procps-ng nodejs npm || {
        echo "⚠️ DNF warning: some packages may already be installed."
    }
elif command -v apt-get &>/dev/null; then
    echo "APT detected. Installing build tools..."
    sudo apt-get update && sudo apt-get install -y python3-dev python3-pip curl gcc g++ procps nodejs npm || {
        echo "⚠️ APT warning: some packages may already be installed."
    }
else
    echo "Non-DNF/APT system. Ensure python3-dev, gcc, pip, node, npm are installed."
fi

echo "=== [3/6] Setting up Python Virtual Environment ==="
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

echo "=== [4/6] Upgrading Pip & Installing Dependencies ==="
pip install --upgrade pip wheel setuptools
pip install --no-cache-dir -r requirements.txt || {
    echo "❌ pip install failed. Common fixes:"
    echo "   sudo dnf install python3-devel gcc-c++"
    echo "   pip install --no-build-isolation -r requirements.txt"
    exit 1
}

echo "=== [5/6] Preparing Frontend ==="
cd frontend
if [ ! -d "node_modules" ]; then
    npm install --no-audit --no-fund --maxsockets 1
fi
cd "$PROJECT_ROOT"

echo "=== [6/6] Launching Services ==="
python backend/server.py &
BACKEND_PID=$!

cd frontend
npm run dev &
FRONTEND_PID=$!
cd "$PROJECT_ROOT"

echo ""
echo "=================================================="
echo "🚀 Talk-With-Me Local Stack is Running!"
echo "Frontend:  http://localhost:5173"
echo "Backend:   http://localhost:8000"
echo "API Docs:  http://localhost:8000/docs"
echo "Health:    http://localhost:8000/health"
echo ""
echo "Press Ctrl+C to stop both services."
echo "=================================================="

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    if command -v fuser &>/dev/null; then
        fuser -k 8000/tcp 2>/dev/null || true
        fuser -k 5173/tcp 2>/dev/null || true
    fi
    echo "Done."
    exit 0
}
trap cleanup SIGINT SIGTERM

wait
