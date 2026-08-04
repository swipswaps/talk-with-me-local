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
