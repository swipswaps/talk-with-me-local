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
