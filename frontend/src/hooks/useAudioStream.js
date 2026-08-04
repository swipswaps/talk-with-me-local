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
      try {
        const data = JSON.parse(event.data);
        setChunks((prev) => [...prev, data]);
        if (data.status === 'complete') {
          setStreaming(false);
          ws.close();
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
        setError('Received invalid data from server');
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
