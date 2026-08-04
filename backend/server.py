import asyncio
import base64
import math
import struct
import time
import uuid
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
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

# -----------------------------------------------------------------------------
# Request ID & timing middleware
# -----------------------------------------------------------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    req_id = str(uuid.uuid4())[:8]
    request.state.req_id = req_id
    t0 = time.perf_counter()
    path = request.url.path
    method = request.method

    print(f'{{"event":"request_start","req_id":"{req_id}","method":"{method}","path":"{path}"}}')

    response = await call_next(request)

    latency_ms = round((time.perf_counter() - t0) * 1000, 2)
    status_code = response.status_code
    print(f'{{"event":"request_end","req_id":"{req_id}","method":"{method}","path":"{path}","status":{status_code},"latency_ms":{latency_ms}}}')

    response.headers["X-Request-ID"] = req_id
    return response

# -----------------------------------------------------------------------------
# Audio generation
# -----------------------------------------------------------------------------
def make_tone_wav(duration_sec=1.0, freq=440, sample_rate=8000, amplitude=100):
    num_samples = int(sample_rate * duration_sec)
    data = bytearray()
    for i in range(num_samples):
        t = i / sample_rate
        val = 128 + int(amplitude * math.sin(2 * math.pi * freq * t))
        val = max(0, min(255, val))
        data.append(val)
    data_bytes = bytes(data)
    header = b'RIFF'
    header += struct.pack('<I', 36 + len(data_bytes))
    header += b'WAVE'
    header += b'fmt '
    header += struct.pack('<I', 16)
    header += struct.pack('<H', 1)
    header += struct.pack('<H', 1)
    header += struct.pack('<I', sample_rate)
    header += struct.pack('<I', sample_rate)
    header += struct.pack('<H', 1)
    header += struct.pack('<H', 8)
    header += b'data'
    header += struct.pack('<I', len(data_bytes))
    return base64.b64encode(header + data_bytes).decode()

TONE_WAV_B64 = make_tone_wav()

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@app.get("/health")
def health_check():
    import sys
    import os
    return {
        "status": "healthy",
        "mode": "lightweight-proxy",
        "memory_safe": True,
        "version": "1.2.0",
        "python_version": sys.version,
        "pid": os.getpid(),
        "timestamp": time.time()
    }

@app.post("/api/synthesize")
def synthesize_speech(payload: SynthesizeRequest, request: Request):
    req_id = getattr(request.state, 'req_id', 'unknown')
    t0 = time.perf_counter()
    print(f'{{"event":"inference_start","req_id":"{req_id}","persona":"{payload.persona}","engine":"{payload.engine}","text_len":{len(payload.text)}}}')

    try:
        # Simulate pipeline stages
        time.sleep(0.05)  # preprocessing
        preprocess_ms = round((time.perf_counter() - t0) * 1000, 2)

        t1 = time.perf_counter()
        time.sleep(0.1)  # inference stub
        inference_ms = round((time.perf_counter() - t1) * 1000, 2)

        t2 = time.perf_counter()
        time.sleep(0.02)  # postprocessing
        postprocess_ms = round((time.perf_counter() - t2) * 1000, 2)

        total_ms = round((time.perf_counter() - t0) * 1000, 2)

        result = {
            "status": "success",
            "engine": payload.engine,
            "persona": payload.persona,
            "audio_base64": TONE_WAV_B64,
            "request_id": req_id,
            "timing_ms": {
                "preprocess": preprocess_ms,
                "inference": inference_ms,
                "postprocess": postprocess_ms,
                "total": total_ms
            },
            "message": "Synthesis stub completed for " + payload.persona + " using " + payload.engine + "."
        }
        print(f'{{"event":"inference_end","req_id":"{req_id}","total_ms":{total_ms},"status":"success"}}')
        return result
    except Exception as e:
        print(f'{{"event":"inference_error","req_id":"{req_id}","error":"{str(e)}"}}')
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Synthesis failure: " + str(e)
        )

@app.websocket("/ws/synthesize")
async def websocket_synthesize(websocket: WebSocket):
    conn_id = str(uuid.uuid4())[:8]
    await websocket.accept()
    print(f'{{"event":"ws_connect","conn_id":"{conn_id}","client":"{websocket.client}"}}')
    try:
        while True:
            t0 = time.perf_counter()
            data = await websocket.receive_json()
            text = data.get("text", "")
            persona = data.get("persona", "Data")
            engine = data.get("engine", "qwen3")

            sentences = [s.strip() for s in text.replace('?', '.').replace('!', '.').split('.') if s.strip()]
            if not sentences:
                sentences = [text]

            print(f'{{"event":"ws_stream_start","conn_id":"{conn_id}","chunks":{len(sentences)}}}')

            for i, chunk in enumerate(sentences, 1):
                chunk_t0 = time.perf_counter()
                await asyncio.sleep(0.3)
                chunk_latency = round((time.perf_counter() - chunk_t0) * 1000, 2)
                await websocket.send_json({
                    "chunk_index": i,
                    "total_chunks": len(sentences),
                    "status": "streaming",
                    "persona": persona,
                    "engine": engine,
                    "text_chunk": chunk,
                    "audio_chunk_base64": TONE_WAV_B64,
                    "chunk_latency_ms": chunk_latency,
                    "conn_id": conn_id
                })
                print(f'{{"event":"ws_chunk_sent","conn_id":"{conn_id}","chunk":{i},"latency_ms":{chunk_latency}}}')

            total_ms = round((time.perf_counter() - t0) * 1000, 2)
            await websocket.send_json({
                "status": "complete",
                "message": "Audio stream transmission finished.",
                "total_stream_ms": total_ms,
                "conn_id": conn_id
            })
            print(f'{{"event":"ws_stream_end","conn_id":"{conn_id}","total_ms":{total_ms}}}')
    except WebSocketDisconnect:
        print(f'{{"event":"ws_disconnect","conn_id":"{conn_id}","reason":"client"}}')
    except Exception as e:
        print(f'{{"event":"ws_error","conn_id":"{conn_id}","error":"{str(e)}"}}')
        await websocket.close()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
