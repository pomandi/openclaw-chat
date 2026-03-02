'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { loadVoiceSettings, type VoiceSettings } from './voiceSettings';

// Types
export type VoiceModeState =
  | 'initializing'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

export type ResponseMode = 'text' | 'voice';

export interface VoiceModeOptions {
  agentId: string;
  sessionKey: string;
  responseMode: ResponseMode;
  onMessageSent?: (text: string) => void;
  onAgentResponse?: (text: string) => void;
  onClose?: () => void;
}

export interface VoiceModeReturn {
  state: VoiceModeState;
  error: string | null;
  accumulatedText: string;
  agentResponse: string;
  speechProbability: number;
  lastTranscript: string;
  manualSend: () => void;
  retry: () => void;
  close: () => void;
  reloadSettings: () => void;
  getAudioLevel: () => number;
}

// Convert Float32Array (16kHz mono) to WAV data URL
function float32ToWavDataUrl(audio: Float32Array): string {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audio.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

// Trigger words — broad matching, including common Whisper variants
const TRIGGER_PATTERNS = [
  /g[oö]nder/i,
  /yolla/i,
  /\bsend\b/i,
];
const EXIT_PATTERNS = [
  /kapat/i,
  /\bclose\b/i,
];

function hasTriggerWord(text: string): boolean {
  return TRIGGER_PATTERNS.some(p => p.test(text));
}

function hasExitWord(text: string): boolean {
  return EXIT_PATTERNS.some(p => p.test(text));
}

function stripTriggerWords(text: string): string {
  let result = text;
  result = result.replace(/g[oö]nder/gi, '');
  result = result.replace(/yolla/gi, '');
  result = result.replace(/\bsend\b/gi, '');
  return result.replace(/[.,!?]+$/, '').trim();
}

// --- Ambient background music (Web Audio API) ---
// Generates a soft warm pad under TTS playback — zero latency, no file needed
function createAmbientPad(ctx: AudioContext): { gain: GainNode; stop: () => void } {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];

  // Soft chord: C3-E3-G3-B3 (warm jazz voicing)
  const freqs = [130.81, 164.81, 196.00, 246.94];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Slight detune for warmth
    osc.detune.value = (Math.random() - 0.5) * 8;

    const g = ctx.createGain();
    g.gain.value = 0.12;

    // Low-pass filter for softness
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.5;

    osc.connect(filter);
    filter.connect(g);
    g.connect(master);
    osc.start();
    oscs.push(osc);
    gains.push(g);
  }

  // Very subtle LFO on gain for gentle movement
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.15; // very slow
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain);
  lfoGain.connect(master.gain);
  lfo.start();

  return {
    gain: master,
    stop: () => {
      oscs.forEach(o => { try { o.stop(); } catch {} });
      try { lfo.stop(); } catch {}
    },
  };
}

function fadeIn(gain: GainNode, target: number, durationSec: number) {
  const now = gain.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(target, now + durationSec);
}

function fadeOut(gain: GainNode, durationSec: number) {
  const now = gain.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + durationSec);
}

export function useVoiceMode({
  agentId,
  sessionKey,
  responseMode,
  onMessageSent,
  onAgentResponse,
  onClose,
}: VoiceModeOptions): VoiceModeReturn {
  const [state, setState] = useState<VoiceModeState>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [accumulatedText, setAccumulatedText] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  const [speechProbability, setSpeechProbability] = useState(0);
  const [lastTranscript, setLastTranscript] = useState('');

  const vadRef = useRef<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const accumulatedRef = useRef('');
  const mountedRef = useRef(true);
  const stateRef = useRef<VoiceModeState>('initializing');
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ambientRef = useRef<{ gain: GainNode; stop: () => void } | null>(null);
  const customMusicRef = useRef<HTMLAudioElement | null>(null);
  const customMusicGainRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const settingsRef = useRef<VoiceSettings>(loadVoiceSettings());

  // Stable refs for values/callbacks used inside the SSE/VAD closures
  const responseModeRef = useRef(responseMode);
  useEffect(() => { responseModeRef.current = responseMode; }, [responseMode]);

  const onMessageSentRef = useRef(onMessageSent);
  const onAgentResponseRef = useRef(onAgentResponse);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onMessageSentRef.current = onMessageSent; }, [onMessageSent]);
  useEffect(() => { onAgentResponseRef.current = onAgentResponse; }, [onAgentResponse]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Helper to set state + ref atomically
  const setStateSync = useCallback((s: VoiceModeState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // Clear auto-send timer
  const clearAutoSend = useCallback(() => {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  }, []);

  // Get audio level from analyser (0-1) for lip-sync
  const getAudioLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * 4); // Scale up for more visible mouth movement
  }, []);

  // Transcribe audio segment
  const transcribe = useCallback(async (audio: Float32Array): Promise<string> => {
    const dataUrl = float32ToWavDataUrl(audio);
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: dataUrl, language: 'tr' }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.text?.trim() || '';
      }
    } catch (e) {
      console.warn('[VoiceMode] Transcription error:', e);
    }
    return '';
  }, []);

  // Send accumulated text to agent — uses ref so it's always current
  const sendToAgentRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Resume VAD listening
  const resumeListening = useCallback(() => {
    if (!mountedRef.current) return;
    setStateSync('listening');
    vadRef.current?.start().catch(() => {});
  }, [setStateSync]);

  // Ensure AudioContext exists
  const ensureAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }, []);

  // Start ambient background music
  const startAmbient = useCallback(() => {
    if (!settingsRef.current.ambientEnabled) return;
    const ctx = ensureAudioCtx();
    const source = settingsRef.current.ambientSource;

    if (source === 'default') {
      // Stop previous if any
      if (ambientRef.current) {
        ambientRef.current.stop();
        ambientRef.current = null;
      }

      const pad = createAmbientPad(ctx);
      ambientRef.current = pad;
      fadeIn(pad.gain, settingsRef.current.ambientVolume, 1.5);
    } else {
      // Custom music from R2
      if (customMusicRef.current) {
        customMusicRef.current.pause();
        customMusicRef.current = null;
      }

      const key = source.replace(/^music\//, '');
      const audio = new Audio(`/api/music/${encodeURIComponent(key)}`);
      audio.loop = true;
      audio.crossOrigin = 'anonymous';
      customMusicRef.current = audio;

      try {
        const mediaSource = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0;
        mediaSource.connect(gainNode);
        gainNode.connect(ctx.destination);
        customMusicGainRef.current = gainNode;

        audio.play().then(() => {
          fadeIn(gainNode, settingsRef.current.ambientVolume, 1.5);
        }).catch(e => console.warn('[VoiceMode] Custom music play error:', e));
      } catch (e) {
        console.warn('[VoiceMode] Custom music setup error:', e);
      }
    }
  }, [ensureAudioCtx]);

  const stopAmbient = useCallback(() => {
    if (ambientRef.current) {
      fadeOut(ambientRef.current.gain, 1.0);
      const ref = ambientRef.current;
      setTimeout(() => { ref.stop(); }, 1200);
      ambientRef.current = null;
    }
    if (customMusicGainRef.current) {
      fadeOut(customMusicGainRef.current, 1.0);
      const audioEl = customMusicRef.current;
      setTimeout(() => {
        if (audioEl) { audioEl.pause(); audioEl.src = ''; }
      }, 1200);
      customMusicRef.current = null;
      customMusicGainRef.current = null;
    }
  }, []);

  // Play TTS audio for agent response
  const playTTS = useCallback(async (text: string) => {
    if (!mountedRef.current) return;
    setStateSync('speaking');

    // Pause VAD during TTS
    try { await vadRef.current?.pause(); } catch {}

    // Start ambient background music
    startAmbient();

    try {
      const s = settingsRef.current;
      const res = await fetch('/api/gateway/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: s.voice,
          rate: s.rate,
          pitch: s.pitch,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      // Apply TTS volume
      audio.volume = s.ttsVolume;

      // Set up AnalyserNode for lip-sync
      try {
        const ctx = ensureAudioCtx();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
      } catch (e) {
        console.warn('[VoiceMode] AnalyserNode setup error:', e);
      }

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        analyserRef.current = null;
        stopAmbient();
        resumeListening();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        analyserRef.current = null;
        stopAmbient();
        console.warn('[VoiceMode] Audio playback error');
        resumeListening();
      };

      await audio.play();
    } catch (err) {
      console.warn('[VoiceMode] TTS error (showing text only):', err);
      analyserRef.current = null;
      stopAmbient();
      if (mountedRef.current) {
        setTimeout(resumeListening, 2000);
      }
    }
  }, [setStateSync, resumeListening, startAmbient, stopAmbient, ensureAudioCtx]);

  // Actual sendToAgent implementation
  const sendToAgent = useCallback(async (text: string) => {
    if (!text.trim()) {
      console.warn('[VoiceMode] sendToAgent: empty text, ignoring');
      return;
    }
    clearAutoSend();
    console.log('[VoiceMode] >>> Sending to agent:', text);

    // Pause VAD while waiting for response
    try { await vadRef.current?.pause(); } catch {}

    setStateSync('thinking');
    setAgentResponse('');
    onMessageSentRef.current?.(text);

    try {
      const res = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message: text, sessionKey }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Chat error ${res.status}: ${errText}`);
      }
      console.log('[VoiceMode] Message sent OK, waiting for SSE response...');
    } catch (err: any) {
      console.error('[VoiceMode] Send error:', err);
      if (mountedRef.current) {
        setStateSync('error');
        setError(`Send failed: ${err.message}`);
      }
    }
  }, [agentId, sessionKey, setStateSync, clearAutoSend]);

  // Keep sendToAgentRef in sync
  useEffect(() => { sendToAgentRef.current = sendToAgent; }, [sendToAgent]);

  // Start auto-send timer (resets on each call)
  const startAutoSend = useCallback(() => {
    clearAutoSend();
    const delayMs = settingsRef.current.autoSendDelay * 1000;
    autoSendTimerRef.current = setTimeout(() => {
      const text = accumulatedRef.current;
      if (text.trim() && mountedRef.current && stateRef.current === 'listening') {
        console.log('[VoiceMode] Auto-send after silence:', text);
        setAccumulatedText(text);
        sendToAgentRef.current(text);
      }
    }, delayMs);
  }, [clearAutoSend]);

  // Manual send — exposed to UI
  const manualSend = useCallback(() => {
    const text = accumulatedRef.current;
    if (!text.trim()) return;
    if (stateRef.current === 'thinking' || stateRef.current === 'speaking') return;
    clearAutoSend();
    console.log('[VoiceMode] Manual send:', text);
    sendToAgentRef.current(text);
  }, [clearAutoSend]);

  // Initialize SSE + VAD on mount
  useEffect(() => {
    mountedRef.current = true;

    // ---- SSE setup ----
    console.log('[VoiceMode] Setting up SSE for', sessionKey);
    const es = new EventSource(
      `/api/gateway/events?sessionKey=${encodeURIComponent(sessionKey)}`
    );
    eventSourceRef.current = es;

    es.onopen = () => {
      console.log('[VoiceMode] SSE connected');
    };

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const payload = JSON.parse(e.data);
        if (payload.sessionKey !== sessionKey) return;

        console.log('[VoiceMode] SSE event:', payload.state, typeof payload.message?.content);

        if (payload.state === 'delta') {
          const text =
            payload.message?.content?.[0]?.text ||
            payload.message?.content?.text ||
            payload.message?.content ||
            '';
          setAgentResponse(text);
          if (stateRef.current !== 'thinking') {
            stateRef.current = 'thinking';
            setState('thinking');
          }
        } else if (payload.state === 'final') {
          const content = payload.message?.content;
          const text = Array.isArray(content)
            ? content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : typeof content === 'string' ? content : String(content || '');

          console.log('[VoiceMode] SSE final response:', text.substring(0, 80));
          setAgentResponse(text);
          onAgentResponseRef.current?.(text);

          // Reset accumulated text for next round
          setAccumulatedText('');
          accumulatedRef.current = '';

          // Voice mode: play TTS then resume. Text mode: show text, resume after delay.
          const mode = responseModeRef.current;
          console.log('[VoiceMode] Response mode:', mode, '| text length:', text.trim().length);
          if (text.trim() && mode === 'voice') {
            playTTS(text);
          } else {
            // Text mode or empty: keep response visible, resume listening after brief pause
            setTimeout(() => {
              if (!mountedRef.current) return;
              stateRef.current = 'listening';
              setState('listening');
              vadRef.current?.start().catch(() => {});
            }, mode === 'text' ? 1500 : 0);
          }
        } else if (payload.state === 'error' || payload.state === 'aborted') {
          const errMsg = payload.errorMessage || 'Agent error';
          console.error('[VoiceMode] SSE error/abort:', errMsg);
          setAgentResponse(`Error: ${errMsg}`);
          stateRef.current = 'listening';
          setState('listening');
          vadRef.current?.start().catch(() => {});
        }
      } catch (err) {
        console.error('[VoiceMode] SSE parse error:', err);
      }
    };

    es.onerror = () => {
      console.warn('[VoiceMode] SSE error (will auto-reconnect)');
    };

    // ---- WakeLock ----
    let wakeLock: WakeLockSentinel | null = null;
    (async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = wakeLock;
        }
      } catch {}
    })();

    // ---- VAD setup ----
    let vad: any = null;
    (async () => {
      stateRef.current = 'initializing';
      setState('initializing');
      setError(null);

      try {
        const { MicVAD } = await import('@ricky0123/vad-web');

        vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
          positiveSpeechThreshold: 0.7,
          negativeSpeechThreshold: 0.3,
          redemptionMs: 1200,
          minSpeechMs: 150,
          preSpeechPadMs: 500,

          onFrameProcessed: (probs: any) => {
            if (mountedRef.current) {
              setSpeechProbability(probs.isSpeech);
            }
          },

          onSpeechStart: () => {
            console.log('[VoiceMode] Speech started');
            if (mountedRef.current) {
              // Clear auto-send timer when new speech starts
              if (autoSendTimerRef.current) {
                clearTimeout(autoSendTimerRef.current);
                autoSendTimerRef.current = null;
              }
              stateRef.current = 'recording';
              setState('recording');
            }
          },

          onSpeechEnd: async (audio: Float32Array) => {
            console.log('[VoiceMode] Speech ended, samples:', audio.length);
            if (!mountedRef.current) return;

            // Don't process speech if we're in thinking/speaking state
            if (stateRef.current === 'thinking' || stateRef.current === 'speaking') {
              console.log('[VoiceMode] Ignoring speech during', stateRef.current);
              return;
            }

            stateRef.current = 'transcribing';
            setState('transcribing');
            const text = await transcribe(audio);

            if (!mountedRef.current) return;

            if (!text) {
              console.log('[VoiceMode] Empty transcription, back to listening');
              stateRef.current = 'listening';
              setState('listening');
              return;
            }

            console.log('[VoiceMode] Transcribed:', JSON.stringify(text));
            setLastTranscript(text);

            // Check for exit word
            if (hasExitWord(text)) {
              console.log('[VoiceMode] Exit word detected');
              onCloseRef.current?.();
              return;
            }

            // Check for trigger word
            if (hasTriggerWord(text)) {
              console.log('[VoiceMode] Trigger word detected!');
              const cleanedSegment = stripTriggerWords(text);
              const fullText = accumulatedRef.current
                ? `${accumulatedRef.current} ${cleanedSegment}`.trim()
                : cleanedSegment;

              if (fullText) {
                console.log('[VoiceMode] Sending (trigger):', fullText);
                try { await vad.pause(); } catch {}
                setAccumulatedText(fullText);
                accumulatedRef.current = fullText;
                await sendToAgentRef.current(fullText);
              } else {
                console.log('[VoiceMode] Trigger found but nothing to send');
                setLastTranscript('Nothing to send yet \u2014 speak first');
                stateRef.current = 'listening';
                setState('listening');
              }
            } else {
              // Accumulate text
              const newAccum = accumulatedRef.current
                ? `${accumulatedRef.current} ${text}`
                : text;
              console.log('[VoiceMode] Accumulated:', newAccum);
              setAccumulatedText(newAccum);
              accumulatedRef.current = newAccum;
              stateRef.current = 'listening';
              setState('listening');

              // Start auto-send timer — will fire if no more speech in N seconds
              if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
              const delayMs = settingsRef.current.autoSendDelay * 1000;
              autoSendTimerRef.current = setTimeout(() => {
                const accum = accumulatedRef.current;
                if (accum.trim() && mountedRef.current && stateRef.current === 'listening') {
                  console.log('[VoiceMode] Auto-send after silence:', accum);
                  sendToAgentRef.current(accum);
                }
              }, delayMs);
            }
          },

          onVADMisfire: () => {
            console.log('[VoiceMode] VAD misfire');
            if (mountedRef.current) {
              stateRef.current = 'listening';
              setState('listening');
            }
          },
        });

        vadRef.current = vad;
        await vad.start();

        if (mountedRef.current) {
          stateRef.current = 'listening';
          setState('listening');
          console.log('[VoiceMode] VAD initialized and listening');
        }
      } catch (err: any) {
        console.error('[VoiceMode] VAD init error:', err);
        if (mountedRef.current) {
          stateRef.current = 'error';
          setState('error');
          setError(err.message || 'Failed to initialize voice detection');
        }
      }
    })();

    // ---- Visibility change ----
    const handleVisibility = () => {
      if (document.hidden) {
        vadRef.current?.pause().catch(() => {});
      } else if (vadRef.current && mountedRef.current) {
        if (stateRef.current === 'listening' || stateRef.current === 'recording') {
          vadRef.current.start().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ---- Cleanup ----
    return () => {
      console.log('[VoiceMode] Cleanup');
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);

      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);

      vadRef.current?.destroy().catch(() => {});
      vadRef.current = null;

      es.close();
      eventSourceRef.current = null;

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      analyserRef.current = null;

      // Clean up ambient
      if (ambientRef.current) {
        ambientRef.current.stop();
        ambientRef.current = null;
      }
      if (customMusicRef.current) {
        customMusicRef.current.pause();
        customMusicRef.current.src = '';
        customMusicRef.current = null;
      }
      customMusicGainRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }

      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [sessionKey, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    clearAutoSend();
    setAccumulatedText('');
    accumulatedRef.current = '';
    setAgentResponse('');
    setLastTranscript('');
    vadRef.current?.destroy().catch(() => {});
    vadRef.current = null;
    (async () => {
      stateRef.current = 'initializing';
      setState('initializing');
      setError(null);
      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        const vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
          positiveSpeechThreshold: 0.7,
          negativeSpeechThreshold: 0.3,
          redemptionMs: 1200,
          minSpeechMs: 150,
          preSpeechPadMs: 500,
          onFrameProcessed: (probs: any) => {
            if (mountedRef.current) setSpeechProbability(probs.isSpeech);
          },
          onSpeechStart: () => {
            if (mountedRef.current) { stateRef.current = 'recording'; setState('recording'); }
          },
          onSpeechEnd: async () => {
            if (mountedRef.current) { stateRef.current = 'listening'; setState('listening'); }
          },
          onVADMisfire: () => {
            if (mountedRef.current) { stateRef.current = 'listening'; setState('listening'); }
          },
        });
        vadRef.current = vad;
        await vad.start();
        if (mountedRef.current) { stateRef.current = 'listening'; setState('listening'); }
      } catch (err: any) {
        if (mountedRef.current) {
          stateRef.current = 'error';
          setState('error');
          setError(err.message);
        }
      }
    })();
  }, [clearAutoSend]);

  const reloadSettings = useCallback(() => {
    settingsRef.current = loadVoiceSettings();
    console.log('[VoiceMode] Settings reloaded:', settingsRef.current);
  }, []);

  const close = useCallback(() => {
    clearAutoSend();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    analyserRef.current = null;
    stopAmbient();
    onCloseRef.current?.();
  }, [clearAutoSend, stopAmbient]);

  return {
    state,
    error,
    accumulatedText,
    agentResponse,
    speechProbability,
    lastTranscript,
    manualSend,
    retry,
    close,
    reloadSettings,
    getAudioLevel,
  };
}
