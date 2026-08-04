import React, { useState, useEffect, useCallback, useRef } from "react";

// Backend WebSocket hook (unchanged)
import { useAudioStream } from "./hooks/useAudioStream";

export default function App() {
  const [persona, setPersona] = useState("Data");
  const [engine, setEngine] = useState("qwen3");
  const [text, setText] = useState("Captain, I think we should do a sick wheelie with the Enterprise.");
  const [loading, setLoading] = useState(false);
  const [responseLog, setResponseLog] = useState(null);
  const [useStreaming, setUseStreaming] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(null);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);

  const { chunks, streaming, error, startStream, stopStream } = useAudioStream();

  // Detect backend on mount
  useEffect(() => {
    fetch("/api/synthesize", { method: "HEAD" })
      .then(() => setBackendAvailable(true))
      .catch(() => setBackendAvailable(false));
  }, []);

  // Load browser TTS voices
  useEffect(() => {
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const v = synth.getVoices();
      setVoices(v);
    };
    loadVoices();
    synth.onvoiceschanged = loadVoices;
    return () => { synth.onvoiceschanged = null; };
  }, []);

  // Map persona to voice characteristics
  const getVoiceForPersona = useCallback(() => {
    const name = selectedVoice ? selectedVoice.name : voices[0].name;
    // Try to find a voice that matches the persona vibe
    if (persona === "Data") {
      return voices.find(v => v.name.includes("Google US English") || v.name.includes("Samantha")) || voices[0];
    }
    if (persona === "Worf") {
      return voices.find(v => v.name.includes("Daniel") || v.name.includes("Fred") || v.lang.startsWith("en")) || voices[0];
    }
    if (persona === "Troi") {
      return voices.find(v => v.name.includes("Victoria") || v.name.includes("Karen") || v.lang.startsWith("en")) || voices[0];
    }
    return voices[0];
  }, [persona, voices, selectedVoice]);

  const speakWithBrowser = useCallback(() => {
    const synth = window.speechSynthesis;
    synth.cancel(); // Stop any ongoing speech

    const utter = new SpeechSynthesisUtterance(text);
    const voice = getVoiceForPersona();
    if (voice) utter.voice = voice;

    // Persona tuning
    if (persona === "Data") { utter.rate = 0.9; utter.pitch = 1.1; }
    else if (persona === "Worf") { utter.rate = 0.85; utter.pitch = 0.8; }
    else if (persona === "Troi") { utter.rate = 1.0; utter.pitch = 1.05; }

    setLoading(true);
    setResponseLog({ status: "browser-tts", message:  });

    utter.onend = () => {
      setLoading(false);
      setResponseLog(prev => ({ ...prev, status: "complete", message: "Browser TTS finished." }));
    };

    utter.onerror = (e) => {
      setLoading(false);
      setResponseLog({ status: "error", message:  });
    };

    synth.speak(utter);
  }, [text, persona, getVoiceForPersona]);

  const streamWithBrowser = useCallback(() => {
    const synth = window.speechSynthesis;
    synth.cancel();


    setLoading(true);
    const logChunks = [];
    let completed = 0;

    sentences.forEach((chunk, i) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      const voice = getVoiceForPersona();
      if (voice) utter.voice = voice;

      if (persona === "Data") { utter.rate = 0.9; utter.pitch = 1.1; }
      else if (persona === "Worf") { utter.rate = 0.85; utter.pitch = 0.8; }
      else if (persona === "Troi") { utter.rate = 1.0; utter.pitch = 1.05; }

      utter.onstart = () => {
        logChunks.push({ chunk_index: i + 1, total_chunks: sentences.length, status: "streaming", text_chunk: chunk });
        setResponseLog({ status: "streaming", chunks: [...logChunks], message:  });
      };

      utter.onend = () => {
        completed++;
        if (completed >= sentences.length) {
          setLoading(false);
          setResponseLog({ status: "complete", chunks: logChunks, message: "Browser TTS stream complete." });
        }
      };

      utter.onerror = (e) => {
        setLoading(false);
        setResponseLog({ status: "error", message:  });
      };

      synth.speak(utter);
    });
  }, [text, persona, getVoiceForPersona]);

  const handleSynthesize = async (e) => {
    e.preventDefault();
    setResponseLog(null);

    // If backend is not available, use browser TTS
    if (backendAvailable === false) {
      if (useStreaming) {
        streamWithBrowser();
      } else {
        speakWithBrowser();
      }
      return;
    }

    // If backend availability unknown, try backend then fall back
    if (backendAvailable === null) {
      try {
        const res = await fetch("/api/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona, engine, text }),
        });
        const data = await res.json();
        setResponseLog(data);
        return;
      } catch {
        setBackendAvailable(false);
        if (useStreaming) streamWithBrowser();
        else speakWithBrowser();
        return;
      }
    }

    // Backend is available
    if (useStreaming) {
      startStream({ persona, engine, text });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, engine, text }),
      });
      const data = await res.json();
      setResponseLog(data);
    } catch (err) {
      setResponseLog({ status: "error", message: err.toString() });
    } finally {
      setLoading(false);
    }
  };

  const modeLabel = backendAvailable === false
    ? "🌐 Browser TTS (no backend detected)"
    : backendAvailable === true
    ? "🔌 Backend mode"
    : "⏳ Detecting...";

  return (
    <div className="min-h-screen p-6 font-sans max-w-4xl mx-auto">
      <header className="mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-cyan-400">Talk With Me : Local Studio</h1>
        <p className="text-sm text-gray-400 mt-1">Unified UI for Qwen3-TTS & Dots.TTS Backend Orchestration</p>
        <p className="text-xs text-yellow-400 mt-1">{modeLabel}</p>
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
              disabled={backendAvailable === false}
            >
              <option value="qwen3">Qwen3-TTS (Fast / Emotion Control)</option>
              <option value="dots">Dots.TTS (High Quality Cloning)</option>
            </select>
            {backendAvailable === false && (
              <p className="text-xs text-gray-500 mt-1">Engine selection requires backend. Using browser voices.</p>
            )}
          </div>

          {backendAvailable === false && voices.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Browser Voice</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs"
                value={selectedVoice ? selectedVoice.name : ""}
                onChange={(e) => {
                  const v = voices.find(voice => voice.name === e.target.value);
                  setSelectedVoice(v || voices[0]);
                }}
              >
                {voices.map(v => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </div>
          )}

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
            <label htmlFor="streaming" className="text-sm text-gray-300">Use Streaming</label>
          </div>

          <div className="flex space-x-2">
            <button
              type="submit"
              disabled={loading || streaming}
              className="flex-1 bg-cyan-600 hover:bg-cyan-500 font-semibold py-2 px-4 rounded transition duration-150 disabled:opacity-50"
            >
              {loading || streaming ? "Synthesizing..." : "Generate Voice Stream"}
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
            {useStreaming && backendAvailable !== false ? (
              <>
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
