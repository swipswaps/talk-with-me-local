import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioStream } from './hooks/useAudioStream';

export default function App() {
  const [persona, setPersona] = useState('Data');
  const [engine, setEngine] = useState('qwen3');
  const [text, setText] = useState('Captain, I think we should do a sick wheelie with the Enterprise.');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [responseLog, setResponseLog] = useState(null);
  const [useStreaming, setUseStreaming] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(null);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const { chunks, streaming, error: wsError, startStream, stopStream } = useAudioStream();
  const synthRef = useRef(window.speechSynthesis);

  // Detect backend
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    fetch('/health', { signal: controller.signal })
      .then((r) => {
        clearTimeout(t);
        if (r.ok) setBackendAvailable(true);
        else throw new Error('unhealthy');
      })
      .catch(() => {
        clearTimeout(t);
        setBackendAvailable(false);
        setUseStreaming(false);
      });
  }, []);

  // Load browser TTS voices with retry
  useEffect(() => {
    const synth = synthRef.current;
    if (!synth) return;

    let retries = 0;
    const loadVoices = () => {
      const v = synth.getVoices();
      if (v.length) {
        setVoices(v);
        if (!selectedVoice) setSelectedVoice(v[0]);
      } else if (retries < 10) {
        retries++;
        setTimeout(loadVoices, 300);
      }
    };

    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }
    return () => { synth.onvoiceschanged = null; };
  }, []);

  const getVoiceForPersona = useCallback(() => {
    if (!voices.length) return null;
    if (persona === 'Data') {
      return voices.find((v) => v.name.includes('Google US English') || v.name.includes('Samantha')) || voices[0];
    }
    if (persona === 'Worf') {
      return voices.find((v) => v.name.includes('Daniel') || v.name.includes('Fred')) || voices[0];
    }
    if (persona === 'Troi') {
      return voices.find((v) => v.name.includes('Victoria') || v.name.includes('Karen')) || voices[0];
    }
    return voices[0];
  }, [persona, voices]);

  const stopAllAudio = useCallback(() => {
    const synth = synthRef.current;
    if (synth) {
      synth.cancel();
      if (synth.paused) synth.resume();
    }
    stopStream();
    setSpeaking(false);
    setLoading(false);
  }, [stopStream]);

  const speakBrowser = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) {
      setResponseLog({ status: 'error', message: 'Browser TTS not supported.' });
      setLoading(false);
      return;
    }

    const v = synth.getVoices();
    if (!v.length) {
      setResponseLog({
        status: 'error',
        message: 'No TTS voices found. On Fedora: sudo dnf install speech-dispatcher espeak-ng'
      });
      setLoading(false);
      return;
    }

    // Aggressive cancel to prevent echo/double-play
    synth.cancel();
    if (synth.paused) synth.resume();

    const utter = new SpeechSynthesisUtterance(text);
    const voice = getVoiceForPersona();
    if (voice) utter.voice = voice;

    if (persona === 'Data') { utter.rate = 0.9; utter.pitch = 1.1; }
    else if (persona === 'Worf') { utter.rate = 0.85; utter.pitch = 0.8; }
    else if (persona === 'Troi') { utter.rate = 1.0; utter.pitch = 1.05; }

    setSpeaking(true);
    setAudioUrl(null);
    setResponseLog({ status: 'speaking', message: 'Speaking as ' + persona + '...' });

    utter.onend = () => {
      setSpeaking(false);
      setResponseLog({ status: 'complete', message: 'Browser TTS finished.' });
    };
    utter.onerror = (e) => {
      setSpeaking(false);
      setResponseLog({ status: 'error', message: 'Speech error: ' + e.error });
    };

    synth.speak(utter);
  }, [text, persona, getVoiceForPersona]);

  const streamBrowser = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) {
      setResponseLog({ status: 'error', message: 'Browser TTS not supported.' });
      setLoading(false);
      return;
    }
    const v = synth.getVoices();
    if (!v.length) {
      setResponseLog({
        status: 'error',
        message: 'No TTS voices found. Install: sudo dnf install speech-dispatcher espeak-ng'
      });
      setLoading(false);
      return;
    }

    synth.cancel();
    if (synth.paused) synth.resume();

    const sentences = text.replace(/[?!]/g, '.').split('.').map((s) => s.trim()).filter((s) => s.length > 0);
    if (!sentences.length) {
      setLoading(false);
      return;
    }

    setSpeaking(true);
    setAudioUrl(null);
    let completed = 0;
    const total = sentences.length;

    sentences.forEach((chunk, i) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      const voice = getVoiceForPersona();
      if (voice) utter.voice = voice;

      if (persona === 'Data') { utter.rate = 0.9; utter.pitch = 1.1; }
      else if (persona === 'Worf') { utter.rate = 0.85; utter.pitch = 0.8; }
      else if (persona === 'Troi') { utter.rate = 1.0; utter.pitch = 1.05; }

      utter.onstart = () => {
        setResponseLog({ status: 'streaming', message: 'Speaking ' + (i + 1) + '/' + total + ': ' + chunk });
      };
      utter.onend = () => {
        completed++;
        if (completed >= total) {
          setSpeaking(false);
          setResponseLog({ status: 'complete', message: 'Browser TTS stream complete.' });
        }
      };
      utter.onerror = () => {
        setSpeaking(false);
        setResponseLog({ status: 'error', message: 'Chunk ' + (i + 1) + ' failed.' });
      };
      synth.speak(utter);
    });
  }, [text, persona, getVoiceForPersona]);

  const handleSynthesize = async (e) => {
    e.preventDefault();
    // Immediate lock — prevents echo from double-clicks
    if (loading || speaking || streaming) return;

    setResponseLog(null);
    setAudioUrl(null);
    setLoading(true);

    if (backendAvailable === false) {
      if (useStreaming) streamBrowser();
      else speakBrowser();
      return;
    }

    if (backendAvailable === null) {
      try {
        const res = await fetch('/api/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ persona, engine, text }),
        });
        if (!res.ok) throw new Error('Backend rejected');
        const data = await res.json();
        setResponseLog(data);
        setBackendAvailable(true);
        if (data.audio_base64) {
          setAudioUrl('data:audio/wav;base64,' + data.audio_base64);
        }
        setLoading(false);
        return;
      } catch {
        setBackendAvailable(false);
        setUseStreaming(false);
        setLoading(false);
        if (useStreaming) streamBrowser();
        else speakBrowser();
        return;
      }
    }

    if (useStreaming) {
      setLoading(false);
      startStream({ persona, engine, text });
      return;
    }

    try {
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona, engine, text }),
      });
      const data = await res.json();
      setResponseLog(data);
      if (data.audio_base64) {
        setAudioUrl('data:audio/wav;base64,' + data.audio_base64);
      }
    } catch (err) {
      setResponseLog({ status: 'error', message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const modeLabel =
    backendAvailable === false
      ? '🌐 Browser TTS (no backend detected)'
      : backendAvailable === true
      ? '🔌 Backend mode'
      : '⏳ Detecting backend...';

  const isActive = loading || speaking || streaming;

  return (
    <div className="min-h-screen p-6 font-sans max-w-4xl mx-auto">
      <header className="mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-cyan-400">Talk With Me : Local Studio</h1>
        <p className="text-sm text-gray-400 mt-1">Unified UI for Qwen3-TTS & Dots.TTS Backend Orchestration</p>
        <p className="text-xs text-yellow-400 mt-1">{modeLabel}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* Backend directions panel */}
          {backendAvailable === false && (
            <div className="bg-yellow-900/30 border border-yellow-700 p-4 rounded-lg">
              <h3 className="text-yellow-400 font-semibold text-sm mb-2">🔌 Enable Full Backend</h3>
              <p className="text-gray-300 text-xs mb-2">
                To unlock WebSocket streaming, Qwen3-TTS engine selection, and higher-quality synthesis:
              </p>
              <div className="bg-gray-900 rounded p-3 font-mono text-xs text-green-400 space-y-1">
                <div>git clone https://github.com/swipswaps/talk-with-me-local.git</div>
                <div>cd talk-with-me-local</div>
                <div>chmod +x run.sh</div>
                <div>./run.sh</div>
                <div className="text-gray-500"># Then open http://localhost:5173</div>
              </div>
              <p className="text-gray-400 text-xs mt-2">
                Or on this machine, run: <span className="text-white font-mono">./run.sh</span>
              </p>
            </div>
          )}

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
                <p className="text-xs text-gray-500 mt-1">Engine selection requires local backend.</p>
              )}
            </div>

            {backendAvailable === false && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Browser Voice {voices.length === 0 && <span className="text-red-400">(none found)</span>}
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs"
                  value={selectedVoice ? selectedVoice.name : ''}
                  onChange={(e) => {
                    const v = voices.find((voice) => voice.name === e.target.value);
                    setSelectedVoice(v || voices[0]);
                  }}
                >
                  {voices.length === 0 && <option value="">No voices — install speech-dispatcher</option>}
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                  ))}
                </select>
                {voices.length === 0 && (
                  <p className="text-xs text-red-400 mt-1">
                    No voices detected. Run: sudo dnf install speech-dispatcher espeak-ng
                  </p>
                )}
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
                disabled={backendAvailable === false}
                className="rounded border-gray-600 bg-gray-900"
              />
              <label htmlFor="streaming" className="text-sm text-gray-300">
                {backendAvailable === false ? 'Streaming (backend required)' : 'Use WebSocket Streaming'}
              </label>
            </div>

            <div className="flex space-x-2">
              <button
                type="submit"
                disabled={isActive}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 font-semibold py-2 px-4 rounded transition duration-150 disabled:opacity-50"
              >
                {isActive ? 'Synthesizing...' : 'Generate Voice Stream'}
              </button>
              {isActive && (
                <button
                  type="button"
                  onClick={stopAllAudio}
                  className="bg-red-600 hover:bg-red-500 font-semibold py-2 px-4 rounded transition duration-150"
                >
                  Stop
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow border border-gray-700 flex flex-col">
          <h2 className="text-lg font-semibold mb-3 text-cyan-300">Execution Output</h2>

          {audioUrl && (
            <div className="mb-3">
              <audio controls src={audioUrl} className="w-full" autoPlay>
                Your browser does not support the audio element.
              </audio>
            </div>
          )}

          <div className="flex-1 bg-gray-900 p-4 rounded border border-gray-700 font-mono text-xs overflow-auto max-h-96">
            {useStreaming && backendAvailable !== false ? (
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
                {wsError && <span className="text-red-400">Error: {wsError}</span>}
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
