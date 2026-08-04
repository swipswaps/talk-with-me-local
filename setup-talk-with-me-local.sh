#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================================================
# Talk-With-Me Local — One-Shot Setup, Push, Pages Deploy & Live Ping
# ============================================================================
# Run this from your project root. It will:
#   1. Create all repo files via heredocs
#   2. git init + commit
#   3. Create empty gh-pages branch (so Pages source can be set immediately)
#   4. gh repo create --public --push
#   5. Enable GitHub Pages via gh api (gh-pages branch source)
#   6. Trigger workflow, wait for build, ping until live
# ============================================================================

REPO_NAME="talk-with-me-local"
OWNER="swipswaps"
PAGES_URL="https://${OWNER}.github.io/${REPO_NAME}/"

echo "=== [0/7] Creating project directory structure ==="
mkdir -p backend frontend/src/hooks .github/workflows

echo "=== [1/7] Writing all repo files ==="

cat > .gitignore << 'EOF'
venv/
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
node_modules/
dist/
build/
.env
.env.local
*.log
.DS_Store
.idea/
.vscode/
*.egg-info/
.pytest_cache/
.coverage
EOF

cat > requirements.txt << 'EOF'
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
pydantic>=2.7.0
requests>=2.31.0
websockets>=12.0
python-multipart>=0.0.9
httpx>=0.27.0
EOF

cat > preflight-check.sh << 'EOF'
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
EOF
chmod +x preflight-check.sh

cat > run.sh << 'EOF'
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
EOF
chmod +x run.sh

cat > backend/server.py << 'PYEOF'
import asyncio
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Talk-With-Me Local API", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SynthesizeRequest(BaseModel):
    persona: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    engine: str = Field(default="qwen3")
    steps: int = Field(default=42, ge=1, le=100)
    cfg: float = Field(default=3.0, ge=0.0, le=20.0)

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "mode": "lightweight-proxy",
        "memory_safe": True,
        "version": "1.2.0"
    }

@app.post("/api/synthesize")
def synthesize_speech(payload: SynthesizeRequest):
    try:
        return {
            "status": "success",
            "engine": payload.engine,
            "persona": payload.persona,
            "audio_base64": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
            "message": f"Synthesis stub completed for {payload.persona} using {payload.engine}."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Synthesis failure: {str(e)}"
        )

@app.websocket("/ws/synthesize")
async def websocket_synthesize(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            text = data.get("text", "")
            persona = data.get("persona", "Data")
            engine = data.get("engine", "qwen3")

            sentences = [s.strip() for s in text.replace('?', '.').replace('!', '.').split('.') if s.strip()]
            if not sentences:
                sentences = [text]

            for i, chunk in enumerate(sentences, 1):
                await asyncio.sleep(0.3)
                await websocket.send_json({
                    "chunk_index": i,
                    "total_chunks": len(sentences),
                    "status": "streaming",
                    "persona": persona,
                    "engine": engine,
                    "text_chunk": chunk,
                    "audio_chunk_base64": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
                })

            await websocket.send_json({
                "status": "complete",
                "message": "Audio stream transmission finished."
            })
    except WebSocketDisconnect:
        print("WebSocket client disconnected.")
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
PYEOF

cat > backend/test_server.py << 'PYEOF'
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import pytest
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data

def test_synthesize_success():
    payload = {
        "persona": "Data",
        "text": "Captain, I think we should do a sick wheelie.",
        "engine": "qwen3",
        "steps": 42,
        "cfg": 3.0
    }
    response = client.post("/api/synthesize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["persona"] == "Data"
    assert "audio_base64" in data

def test_synthesize_invalid_payload():
    response = client.post("/api/synthesize", json={"persona": "Worf"})
    assert response.status_code == 422
PYEOF

cat > frontend/package.json << 'EOF'
{
  "name": "talk-with-me-frontend",
  "private": true,
  "version": "1.2.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "vite": "^5.3.1"
  }
}
EOF

cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
EOF

cat > frontend/postcss.config.js << 'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOF

cat > frontend/vite.config.js << 'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/talk-with-me-local/' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
}))
EOF

cat > frontend/index.html << 'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Talk With Me - Local AI Voice Studio</title>
  </head>
  <body class="bg-gray-900 text-gray-100">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

cat > frontend/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  min-height: 100vh;
  background-color: #111827;
  color: #f3f4f6;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
EOF

cat > frontend/src/main.jsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
EOF

cat > frontend/src/hooks/useAudioStream.js << 'EOF'
import { useState, useCallback, useRef } from 'react';

export function useAudioStream() {
  const [chunks, setChunks] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);

  const startStream = useCallback((payload) => {
    setChunks([]);
    setStreaming(true);
    setError(null);

    const ws = new WebSocket('ws://localhost:8000/ws/synthesize');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setChunks((prev) => [...prev, data]);
      if (data.status === 'complete') {
        setStreaming(false);
        ws.close();
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setError('WebSocket connection failed');
      setStreaming(false);
    };

    ws.onclose = () => {
      setStreaming(false);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, []);

  const stopStream = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setStreaming(false);
  }, []);

  return { chunks, streaming, error, startStream, stopStream };
}
EOF

cat > frontend/src/App.jsx << 'EOF'
import React, { useState } from 'react';
import { useAudioStream } from './hooks/useAudioStream';

export default function App() {
  const [persona, setPersona] = useState('Data');
  const [engine, setEngine] = useState('qwen3');
  const [text, setText] = useState('Captain, I think we should do a sick wheelie with the Enterprise.');
  const [loading, setLoading] = useState(false);
  const [responseLog, setResponseLog] = useState(null);
  const [useStreaming, setUseStreaming] = useState(false);

  const { chunks, streaming, error, startStream, stopStream } = useAudioStream();

  const handleSynthesize = async (e) => {
    e.preventDefault();
    setResponseLog(null);

    if (useStreaming) {
      startStream({ persona, engine, text });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona, engine, text }),
      });
      const data = await res.json();
      setResponseLog(data);
    } catch (err) {
      setResponseLog({ status: 'error', message: err.toString() });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 font-sans max-w-4xl mx-auto">
      <header className="mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-cyan-400">Talk With Me : Local Studio</h1>
        <p className="text-sm text-gray-400 mt-1">Unified UI for Qwen3-TTS & Dots.TTS Backend Orchestration</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={handleSynthesize} className="bg-gray-800 p-6 rounded-lg shadow border border-gray-700 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Persona</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            >
              <option value="Data">Commander Data (TNG)</option>
              <option value="Worf">Lieutenant Worf</option>
              <option value="Troi">Counselor Troi</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">TTS Engine</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
            >
              <option value="qwen3">Qwen3-TTS (Fast / Emotion Control)</option>
              <option value="dots">Dots.TTS (High Quality Cloning)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Script to Synthesize</label>
            <textarea
              rows="4"
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="streaming"
              checked={useStreaming}
              onChange={(e) => setUseStreaming(e.target.checked)}
              className="rounded border-gray-600 bg-gray-900"
            />
            <label htmlFor="streaming" className="text-sm text-gray-300">Use WebSocket Streaming</label>
          </div>

          <div className="flex space-x-2">
            <button
              type="submit"
              disabled={loading || streaming}
              className="flex-1 bg-cyan-600 hover:bg-cyan-500 font-semibold py-2 px-4 rounded transition duration-150 disabled:opacity-50"
            >
              {loading || streaming ? 'Synthesizing...' : 'Generate Voice Stream'}
            </button>
            {streaming && (
              <button
                type="button"
                onClick={stopStream}
                className="bg-red-600 hover:bg-red-500 font-semibold py-2 px-4 rounded transition duration-150"
              >
                Stop
              </button>
            )}
          </div>
        </form>

        <div className="bg-gray-800 p-6 rounded-lg shadow border border-gray-700 flex flex-col">
          <h2 className="text-lg font-semibold mb-3 text-cyan-300">Execution Output</h2>
          <div className="flex-1 bg-gray-900 p-4 rounded border border-gray-700 font-mono text-xs overflow-auto max-h-96">
            {useStreaming ? (
              <>
                {chunks.length === 0 && !streaming && (
                  <span className="text-gray-500">Awaiting streaming request...</span>
                )}
                {chunks.map((chunk, i) => (
                  <div key={i} className="mb-2 text-green-400">
                    <span className="text-cyan-500">[{chunk.status}]</span> {JSON.stringify(chunk, null, 2)}
                  </div>
                ))}
                {streaming && <span className="text-yellow-400 animate-pulse">Streaming...</span>}
                {error && <span className="text-red-400">Error: {error}</span>}
              </>
            ) : (
              <>
                {responseLog ? (
                  <pre className="text-green-400">{JSON.stringify(responseLog, null, 2)}</pre>
                ) : (
                  <span className="text-gray-500">Awaiting inference request...</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
EOF

cat > .github/workflows/deploy.yml << 'EOF'
name: Deploy Frontend to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd frontend
          npm ci

      - name: Build
        run: |
          cd frontend
          npm run build

      - name: Deploy to gh-pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./frontend/dist
          force_orphan: true
EOF

cat > README.md << 'EOF'
# Talk-With-Me Local

A lightweight, local-first web interface and API for AI text-to-speech orchestration.  
Built with **FastAPI** (backend) and **Vite + React + Tailwind CSS** (frontend).  
Designed for easy setup on Fedora Linux and low-RAM systems.

> ⚠️ **Current Status**: The backend runs as a lightweight proxy/stub. It returns dummy base64 audio. You must integrate actual Qwen3-TTS or Dots.TTS model weights for real speech synthesis.

## Quick Start

```bash
chmod +x preflight-check.sh run.sh
./preflight-check.sh   # Verify system readiness
./run.sh               # Install deps and launch stack
```

Open http://localhost:5173

## Endpoints

| URL | Description |
|-----|-------------|
| http://localhost:5173 | React frontend |
| http://localhost:8000 | FastAPI backend |
| http://localhost:8000/docs | Swagger API docs |
| http://localhost:8000/health | Health check |
| ws://localhost:8000/ws/synthesize | WebSocket streaming |

## Prerequisites (Fedora 43)

```bash
sudo dnf install python3-devel gcc-c++ procps-ng nodejs npm
```

## Troubleshooting

**Python.h missing / pip install fails**
```bash
sudo dnf install python3-devel gcc-c++
```

**Port already in use**
```bash
fuser -k 8000/tcp
fuser -k 5173/tcp
```

**npm install hangs on low RAM**
Handled automatically by `run.sh` (`--maxsockets 1`).
Manual fix: `cd frontend && npm install --maxsockets 1`

**Prebuilt wheels vs source builds**
For heavy CUDA packages (PyTorch, FlashAttention), always use prebuilt wheels:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

## Running Tests

```bash
source venv/bin/activate
pytest backend/test_server.py -v
```

## GitHub Pages

The frontend is auto-deployed to GitHub Pages via GitHub Actions on every push to `main`.
Visit: `https://swipswaps.github.io/talk-with-me-local/`

> Note: GitHub Pages hosts only the static frontend. The backend must be running locally for full functionality.

## Adding Real TTS Models

Edit `backend/server.py` and replace the stub response in `/api/synthesize` with actual model inference. Ensure sufficient VRAM (12GB+ recommended).

## License

MIT
EOF

echo "=== [2/7] All files written. Initializing git ==="
git init
git add .
git commit -m "feat: initial talk-with-me-local stack

- FastAPI backend with REST + WebSocket streaming
- Vite + React + Tailwind CSS frontend
- Lightweight proxy mode for low-RAM systems
- Fedora 43 auto-detection and dependency management
- Pre-flight inspection script
- GitHub Actions workflow for Pages deployment"

echo "=== [3/7] Creating orphan gh-pages branch (placeholder) ==="
git checkout --orphan gh-pages
git rm -rf . 2>/dev/null || true
echo '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=https://github.com/swipswaps/talk-with-me-local"></head><body>Redirecting...</body></html>' > index.html
git add index.html
git commit -m "init: gh-pages placeholder"
git checkout main

echo "=== [4/7] Creating GitHub repo via gh CLI ==="
gh repo create "${REPO_NAME}" --public --source=. --remote=origin --push || {
    echo "⚠️ gh repo create failed. Trying manual push..."
    gh repo create "${REPO_NAME}" --public
    git remote add origin "https://github.com/${OWNER}/${REPO_NAME}.git"
    git branch -M main
    git push -u origin main
}

echo "=== [5/7] Pushing gh-pages branch ==="
git push origin gh-pages || echo "⚠️ gh-pages push failed (may already exist)"

echo "=== [6/7] Enabling GitHub Pages via gh api ==="
echo "Attempting to set Pages source to gh-pages branch..."
gh api "repos/${OWNER}/${REPO_NAME}/pages" \
    --method POST \
    -f source[branch]=gh-pages \
    -f source[path]=/ 2>/dev/null || \
gh api "repos/${OWNER}/${REPO_NAME}/pages" \
    --method PUT \
    -f source[branch]=gh-pages \
    -f source[path]=/ 2>/dev/null || {
    echo "⚠️ Auto-enable via gh api failed (known path=/ bug or already enabled)."
    echo "   Manual fallback: Go to https://github.com/${OWNER}/${REPO_NAME}/settings/pages"
    echo "   Select 'Deploy from a branch' → 'gh-pages' → '/' and Save."
}

echo "=== [6.5/7] Triggering workflow and waiting for build ==="
gh workflow run deploy.yml --repo "${OWNER}/${REPO_NAME}" 2>/dev/null || true
sleep 5

echo "Waiting for workflow to complete..."
RUN_ID=$(gh run list --repo "${OWNER}/${REPO_NAME}" --workflow=deploy.yml --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
if [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ]; then
    gh run watch --repo "${OWNER}/${REPO_NAME}" "$RUN_ID" --exit-status || {
        echo "⚠️ Workflow failed or timed out. Check: https://github.com/${OWNER}/${REPO_NAME}/actions"
    }
else
    echo "ℹ️ Could not detect workflow run ID. It may start shortly."
    echo "   Check manually: https://github.com/${OWNER}/${REPO_NAME}/actions"
fi

echo "=== [7/7] Pinging Pages site every 10s until live ==="
echo "Target URL: ${PAGES_URL}"
echo "(Press Ctrl+C to stop pinging)"

ATTEMPT=0
while true; do
    ATTEMPT=$((ATTEMPT + 1))
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${PAGES_URL}" 2>/dev/null || echo "000")

    if [ "$STATUS" = "200" ]; then
        echo ""
        echo "=================================================="
        echo "✅ SITE IS LIVE!"
        echo "${PAGES_URL}"
        echo "=================================================="
        echo ""
        echo "Next steps:"
        echo "  1. Run ./preflight-check.sh locally"
        echo "  2. Run ./run.sh to start the backend + frontend locally"
        echo "  3. Open http://localhost:5173 for local dev"
        echo "  4. Visit ${PAGES_URL} for the static frontend demo"
        exit 0
    elif [ "$STATUS" = "404" ]; then
        echo "⏳ [$ATTEMPT] Status: 404 (Pages not ready yet — retrying in 10s...)"
    elif [ "$STATUS" = "000" ]; then
        echo "⏳ [$ATTEMPT] Status: connection failed (DNS/propagation — retrying in 10s...)"
    else
        echo "⏳ [$ATTEMPT] Status: $STATUS (retrying in 10s...)"
    fi

    sleep 10
done
