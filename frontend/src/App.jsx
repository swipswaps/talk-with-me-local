import React, { useState, useEffect, useCallback } from 'react';
import { useAudioStream } from './hooks/useAudioStream';

function TimelineEntry({ entry }) {
  const color =
    entry.level === 'error' ? 'text-red-400' :
    entry.level === 'warn' ? 'text-yellow-400' :
    entry.level === 'success' ? 'text-green-400' :
    'text-cyan-400';
  return (
    <div className="mb-1 border-l-2 border-gray-600 pl-2">
      <span className="text-gray-500 text-[10px]">{entry.time}</span>{' '}
      <span className={color + ' text-[11px] font-semibold'}>[{entry.stage}]</span>{' '}
      <span className="text-gray-300 text-[11px]">{entry.message}</span>
      {entry.ms && <span className="text-gray-500 text-[10px] ml-1">({entry.ms}ms)</span>}
    </div>
  );
}

export default function App() {
  const [persona, setPersona] = useState('Data');
  const [engine, setEngine] = useState('qwen3');
  const [text, setText] = useState('Captain, I think we should do a sick wheelie with the Enterprise.');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [useStreaming, setUseStreaming] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(null);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [reqId, setReqId] = useState(null);

  const { chunks, streaming, error: wsError, startStream, stopStream } = useAudioStream();

  const now = () => new Date().toLocaleTimeString().split(' ')[0];

  const log = useCallback((stage, message, level = 'info', ms) => {
    setTimeline((prev) => [...prev, { time: now(), stage, message, level, ms }]);
  }, []);

  useEffect(() => {
    log('INIT', 'Frontend mounted, detecting backend...');
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    fetch('/health', { signal: controller.signal })
      .then((r) => {
        clearTimeout(t);
        if (r.ok) {
          setBackendAvailable(true);
          log('BACKEND', 'FastAPI backend detected at localhost:8000', 'success');
        } else throw new Error('unhealthy');
      })
      .catch(() => {
        clearTimeout(t);
        setBackendAvailable(false);
        setUseStreaming(false);
        log('BACKEND', 'No backend detected — falling back to browser TTS', 'warn');
      });
  }, []);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    let retries = 0;
    const loadVoices = () => {
      const v = synth.getVoices();
      if (v.length) {
        setVoices(v);
        if (!selectedVoice) setSelectedVoice(v[0]);
        log('VOICES', 'Loaded ' + v.length + ' browser voices', 'success');
      } else if (retries < 10) {
        retries++;
        setTimeout(loadVoices, 300);
      } else {
        log('VOICES', 'No browser voices found after 10 retries', 'warn');
      }
    };
    loadVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
    return () => { synth.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    if (chunks.length > 0) {
      const last = chunks[chunks.length - 1];
      if (last.status === 'complete') {
        log('STREAM', 'WebSocket stream complete', 'success', last.total_stream_ms);
        if (chunks.length > 1 && chunks[0].audio_chunk_base64) {
          setAudioUrl('data:audio/wav;base64,' + chunks[0].audio_chunk_base64);
        }
      } else if (last.status === 'streaming') {
        log('STREAM', 'Chunk ' + last.chunk_index + '/' + last.total_chunks + ' received', 'info', last.chunk_latency_ms);
      }
    }
  }, [chunks]);

  const getVoiceForPersona = useCallback(() => {
    if (!voices.length) return null;
    if (persona === 'Data') return voices.find((v) => v.name.includes('Google US English') || v.name.includes('Samantha')) || voices[0];
    if (persona === 'Worf') return voices.find((v) => v.name.includes('Daniel') || v.name.includes('Fred')) || voices[0];
    if (persona === 'Troi') return voices.find((v) => v.name.includes('Victoria') || v.name.includes('Karen')) || voices[0];
    return voices[0];
  }, [persona, voices]);

  const stopAllAudio = useCallback(() => {
    const synth = window.speechSynthesis;
    if (synth) { synth.cancel(); if (synth.paused) synth.resume(); }
    stopStream();
    setSpeaking(false);
    setLoading(false);
    log('USER', 'Stop button clicked', 'warn');
  }, [stopStream, log]);

  const speakBrowser = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) { log('BROWSER_TTS', 'speechSynthesis API not available', 'error'); return; }
    if (!synth.getVoices().length) { log('BROWSER_TTS', 'No voices — run: sudo dnf install speech-dispatcher', 'error'); return; }
    synth.cancel(); if (synth.paused) synth.resume();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = getVoiceForPersona();
    if (voice) utter.voice = voice;
    if (persona === 'Data') { utter.rate = 0.9; utter.pitch = 1.1; }
    else if (persona === 'Worf') { utter.rate = 0.85; utter.pitch = 0.8; }
    else if (persona === 'Troi') { utter.rate = 1.0; utter.pitch = 1.05; }
    setSpeaking(true); setAudioUrl(null);
    log('BROWSER_TTS', 'Speaking as ' + persona + ' with voice ' + (voice ? voice.name : 'default'));
    utter.onend = () => { setSpeaking(false); log('BROWSER_TTS', 'Finished', 'success'); };
    utter.onerror = (e) => { setSpeaking(false); log('BROWSER_TTS', 'Error: ' + e.error, 'error'); };
    synth.speak(utter);
  }, [text, persona, getVoiceForPersona, log]);

  const streamBrowser = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth || !synth.getVoices().length) { log('BROWSER_TTS', 'No voices available', 'error'); setLoading(false); return; }
    synth.cancel(); if (synth.paused) synth.resume();
    const sentences = text.replace(/[?!]/g, '.').split('.').map((s) => s.trim()).filter((s) => s.length > 0);
    if (!sentences.length) { setLoading(false); return; }
    setSpeaking(true); setAudioUrl(null);
    let completed = 0;
    log('BROWSER_TTS', 'Starting sentence-by-sentence stream (' + sentences.length + ' chunks)');
    sentences.forEach((chunk, i) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      const voice = getVoiceForPersona();
      if (voice) utter.voice = voice;
      if (persona === 'Data') { utter.rate = 0.9; utter.pitch = 1.1; }
      else if (persona === 'Worf') { utter.rate = 0.85; utter.pitch = 0.8; }
      else if (persona === 'Troi') { utter.rate = 1.0; utter.pitch = 1.05; }
      utter.onstart = () => { log('BROWSER_TTS', 'Chunk ' + (i + 1) + '/' + sentences.length + ': "' + chunk.substring(0, 30) + '..."'); };
      utter.onend = () => { completed++; if (completed >= sentences.length) { setSpeaking(false); log('BROWSER_TTS', 'Stream complete', 'success'); } };
      utter.onerror = () => { setSpeaking(false); log('BROWSER_TTS', 'Chunk ' + (i + 1) + ' failed', 'error'); };
      synth.speak(utter);
    });
  }, [text, persona, getVoiceForPersona, log]);

  const handleSynthesize = async (e) => {
    e.preventDefault();
    if (loading || speaking || streaming) return;
    setAudioUrl(null);
    setTimeline([]); // clear for new run
    const rid = 'req-' + Math.random().toString(36).substring(2, 10);
    setReqId(rid);
    setLoading(true);
    log('USER', 'Generate clicked — request ' + rid);

    if (backendAvailable === false) {
      log('FALLBACK', 'Backend unavailable — routing to browser TTS', 'warn');
      if (useStreaming) streamBrowser();
      else speakBrowser();
      return;
    }

    if (backendAvailable === null) {
      log('PROBE', 'Backend state unknown — attempting direct call');
      try {
        const t0 = performance.now();
        const res = await fetch('/api/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Request-ID': rid },
          body: JSON.stringify({ persona, engine, text }),
        });
        const latency = Math.round(performance.now() - t0);
        if (!res.ok) throw new Error('Backend rejected');
        const data = await res.json();
        setBackendAvailable(true);
        setReqId(data.request_id || rid);
        log('HTTP', 'Response received — req_id: ' + (data.request_id || rid), 'success', latency);
        if (data.timing_ms) {
          log('TIMING', 'preprocess=' + data.timing_ms.preprocess + ' inference=' + data.timing_ms.inference + ' postprocess=' + data.timing_ms.postprocess, 'info', data.timing_ms.total);
        }
        setResponseLog(data);
        if (data.audio_base64) setAudioUrl('data:audio/wav;base64,' + data.audio_base64);
        setLoading(false);
        return;
      } catch (err) {
        log('HTTP', 'Backend call failed — ' + String(err), 'error');
        setBackendAvailable(false);
        setUseStreaming(false);
        setLoading(false);
        if (useStreaming) streamBrowser();
        else speakBrowser();
        return;
      }
    }

    if (useStreaming) {
      log('WEBSOCKET', 'Opening stream for: ' + text.substring(0, 40) + '...');
      setLoading(false);
      startStream({ persona, engine, text });
      return;
    }

    try {
      const t0 = performance.now();
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': rid },
        body: JSON.stringify({ persona, engine, text }),
      });
      const latency = Math.round(performance.now() - t0);
      const data = await res.json();
      setReqId(data.request_id || rid);
      log('HTTP', 'Response — req_id: ' + (data.request_id || rid), 'success', latency);
      if (data.timing_ms) {
        log('TIMING', 'preprocess=' + data.timing_ms.preprocess + ' inference=' + data.timing_ms.inference + ' postprocess=' + data.timing_ms.postprocess, 'info', data.timing_ms.total);
      }
      setResponseLog(data);
      if (data.audio_base64) setAudioUrl('data:audio/wav;base64,' + data.audio_base64);
    } catch (err) {
      log('HTTP', 'Error: ' + String(err), 'error');
      setResponseLog({ status: 'error', message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const modeLabel =
    backendAvailable === false ? '🌐 Browser TTS (no backend detected)' :
    backendAvailable === true ? '🔌 Backend mode' :
    '⏳ Detecting backend...';

  const isActive = loading || speaking || streaming;

  return (
    <div className="min-h-screen p-6 font-sans max-w-5xl mx-auto">
      <header className="mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-cyan-400">Talk With Me : Local Studio</h1>
        <p className="text-sm text-gray-400 mt-1">Unified UI for Qwen3-TTS & Dots.TTS Backend Orchestration</p>
        <p className="text-xs text-yellow-400 mt-1">{modeLabel}{reqId ? ' | req: ' + reqId : ''}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN — Controls */}
        <div className="lg:col-span-1 space-y-4">
          {backendAvailable === false && (
            <div className="bg-yellow-900/30 border border-yellow-700 p-4 rounded-lg">
              <h3 className="text-yellow-400 font-semibold text-sm mb-2">🔌 Enable Full Backend</h3>
              <div className="bg-gray-900 rounded p-3 font-mono text-xs text-green-400 space-y-1">
                <div>cd talk-with-me-local</div>
                <div>./run.sh</div>
                <div className="text-gray-500"># Then open http://localhost:5173</div>
              </div>
            </div>
          )}

          <form onSubmit={handleSynthesize} className="bg-gray-800 p-6 rounded-lg shadow border border-gray-700 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Select Persona</label>
              <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="Data">Commander Data (TNG)</option>
                <option value="Worf">Lieutenant Worf</option>
                <option value="Troi">Counselor Troi</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">TTS Engine</label>
              <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={engine} onChange={(e) => setEngine(e.target.value)} disabled={backendAvailable === false}>
                <option value="qwen3">Qwen3-TTS (Fast / Emotion Control)</option>
                <option value="dots">Dots.TTS (High Quality Cloning)</option>
              </select>
              {backendAvailable === false && <p className="text-xs text-gray-500 mt-1">Engine selection requires local backend.</p>}
            </div>

            {backendAvailable === false && (
              <div>
                <label className="block text-sm font-medium mb-1">Browser Voice {voices.length === 0 && <span className="text-red-400">(none found)</span>}</label>
                <select className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs" value={selectedVoice ? selectedVoice.name : ''} onChange={(e) => { const v = voices.find((voice) => voice.name === e.target.value); setSelectedVoice(v || voices[0]); }}>
                  {voices.length === 0 && <option value="">No voices — install speech-dispatcher</option>}
                  {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                </select>
                {voices.length === 0 && <p className="text-xs text-red-400 mt-1">Run: sudo dnf install speech-dispatcher espeak-ng</p>}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Script to Synthesize</label>
              <textarea rows="4" className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={text} onChange={(e) => setText(e.target.value)} />
            </div>

            <div className="flex items-center space-x-2">
              <input type="checkbox" id="streaming" checked={useStreaming} onChange={(e) => setUseStreaming(e.target.checked)} disabled={backendAvailable === false} className="rounded border-gray-600 bg-gray-900" />
              <label htmlFor="streaming" className="text-sm text-gray-300">{backendAvailable === false ? 'Streaming (backend required)' : 'Use WebSocket Streaming'}</label>
            </div>

            <div className="flex space-x-2">
              <button type="submit" disabled={isActive} className="flex-1 bg-cyan-600 hover:bg-cyan-500 font-semibold py-2 px-4 rounded transition duration-150 disabled:opacity-50">
                {isActive ? 'Synthesizing...' : 'Generate Voice Stream'}
              </button>
              {isActive && (
                <button type="button" onClick={stopAllAudio} className="bg-red-600 hover:bg-red-500 font-semibold py-2 px-4 rounded transition duration-150">Stop</button>
              )}
            </div>

            <button type="button" onClick={speakBrowser} disabled={isActive} className="w-full bg-purple-600 hover:bg-purple-500 font-semibold py-2 px-4 rounded transition duration-150 disabled:opacity-50 text-sm">
              🔊 Preview with Browser Voice
            </button>
          </form>
        </div>

        {/* MIDDLE COLUMN — Execution Timeline */}
        <div className="lg:col-span-1 bg-gray-800 p-6 rounded-lg shadow border border-gray-700 flex flex-col">
          <h2 className="text-lg font-semibold mb-3 text-cyan-300">Execution Timeline</h2>
          <div className="flex-1 bg-gray-900 p-3 rounded border border-gray-700 overflow-auto max-h-[500px]">
            {timeline.length === 0 && <span className="text-gray-500 text-xs">No events yet. Click Generate to start.</span>}
            {timeline.map((entry, i) => <TimelineEntry key={i} entry={entry} />)}
            {wsError && <TimelineEntry entry={{ time: now(), stage: 'WS', message: wsError, level: 'error' }} />}
          </div>
        </div>

        {/* RIGHT COLUMN — Audio & Raw JSON */}
        <div className="lg:col-span-1 bg-gray-800 p-6 rounded-lg shadow border border-gray-700 flex flex-col">
          <h2 className="text-lg font-semibold mb-3 text-cyan-300">Audio Output</h2>

          {audioUrl && (
            <div className="mb-3 bg-gray-900 p-3 rounded border border-gray-600">
              <p className="text-xs text-gray-400 mb-1">Backend audio response:</p>
              <audio controls src={audioUrl} className="w-full">
                Your browser does not support the audio element.
              </audio>
            </div>
          )}

          <h3 className="text-sm font-semibold mb-2 text-gray-400">Raw Response</h3>
          <div className="flex-1 bg-gray-900 p-3 rounded border border-gray-700 font-mono text-xs overflow-auto max-h-[300px]">
            {useStreaming && backendAvailable !== false ? (
              <>
                {chunks.length === 0 && !streaming && <span className="text-gray-500">Awaiting streaming request...</span>}
                {chunks.map((chunk, i) => (
                  <div key={i} className="mb-2 text-green-400">
                    <span className="text-cyan-500">[{chunk.status}]</span> {JSON.stringify(chunk, null, 2)}
                  </div>
                ))}
                {streaming && <span className="text-yellow-400 animate-pulse">Streaming...</span>}
              </>
            ) : (
              <>
                {responseLog ? <pre className="text-green-400">{JSON.stringify(responseLog, null, 2)}</pre> : <span className="text-gray-500">Awaiting inference request...</span>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
