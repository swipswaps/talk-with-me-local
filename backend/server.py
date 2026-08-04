import asyncio
import base64
import struct
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

def make_silent_wav(duration_sec=0.5, sample_rate=8000):
    """Generate a valid silent WAV file as base64."""
    num_samples = int(sample_rate * duration_sec)
    data = b'\x80' * num_samples  # silence for unsigned 8-bit PCM

    header = b'RIFF'
    header += struct.pack('<I', 36 + len(data))
    header += b'WAVE'
    header += b'fmt '
    header += struct.pack('<I', 16)   # Subchunk1Size
    header += struct.pack('<H', 1)    # AudioFormat = PCM
    header += struct.pack('<H', 1)    # NumChannels = mono
    header += struct.pack('<I', sample_rate)
    header += struct.pack('<I', sample_rate)  # ByteRate
    header += struct.pack('<H', 1)    # BlockAlign
    header += struct.pack('<H', 8)    # BitsPerSample
    header += b'data'
    header += struct.pack('<I', len(data))

    return base64.b64encode(header + data).decode()

SILENT_WAV_B64 = make_silent_wav()

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
            "audio_base64": SILENT_WAV_B64,
            "message": "Synthesis stub completed for " + payload.persona + " using " + payload.engine + "."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Synthesis failure: " + str(e)
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
                    "audio_chunk_base64": SILENT_WAV_B64
                })

            await websocket.send_json({
                "status": "complete",
                "message": "Audio stream transmission finished."
            })
    except WebSocketDisconnect:
        print("WebSocket client disconnected.")
    except Exception as e:
        print("WebSocket error: " + str(e))
        await websocket.close()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
