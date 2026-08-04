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
