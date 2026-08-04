#!/usr/bin/env bash
set -Eeuo pipefail

echo "=== [Pre-Flight Inspection] Starting System & Environment Audit ==="
EXIT_CODE=0

if command -v python3 &>/dev/null; then
    PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    echo "[PASS] Python 3 detected (v${PY_VERSION})"
    if python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"; then
        echo "[PASS] Python version meets requirements (>= 3.10)"
    else
        echo "[FAIL] Python version is too old. Requires >= 3.10."
        EXIT_CODE=1
    fi
else
    echo "[FAIL] python3 not found in PATH."
    EXIT_CODE=1
fi

if command -v g++ &>/dev/null; then
    GCC_VERSION=$(g++ -dumpversion)
    echo "[PASS] GCC compiler detected (v${GCC_VERSION})"
else
    echo "[FAIL] g++ compiler not found. Run: sudo dnf install gcc-c++"
    EXIT_CODE=1
fi

if command -v node &>/dev/null && command -v npm &>/dev/null; then
    echo "[PASS] Node.js $(node -v) and npm $(npm -v) detected"
else
    echo "[FAIL] Node.js or npm not found. Run: sudo dnf install nodejs npm"
    EXIT_CODE=1
fi

if command -v nvidia-smi &>/dev/null; then
    echo "[PASS] nvidia-smi detected"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "[WARN] nvidia-smi present but driver not responding"
else
    echo "[INFO] nvidia-smi not found. CPU-only mode."
fi

for port in 8000 5173; do
    if command -v ss &>/dev/null && ss -tln 2>/dev/null | grep -q ":${port} "; then
        echo "[WARN] Port ${port} already in use"
    else
        echo "[PASS] Port ${port} available"
    fi
done

if command -v fuser &>/dev/null; then
    echo "[PASS] fuser detected (procps-ng installed)"
else
    echo "[WARN] fuser not found. Install procps-ng for automatic port cleanup"
fi

echo "--------------------------------------------------"
if [ "$EXIT_CODE" -eq 0 ]; then
    echo "✅ Pre-flight inspection passed. Run ./run.sh next."
else
    echo "❌ Pre-flight inspection failed. Fix errors above, then retry."
    exit 1
fi
