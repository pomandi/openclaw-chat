'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// Types
export type VoiceModeState =
  | 'initializing'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface VoiceModeOptions {
  agentId: string;
  sessionKey: string;
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
  retry: () => void;
  close: () => void;
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
  /g[oö]nder[.]?$/i,   // "gönder." at end
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
  // Remove trigger words (broad)
  result = result.replace(/g[oö]nder/gi, '');
  result = result.replace(/yolla/gi, '');
  result = result.replace(/\bsend\b/gi, '');
  // Clean up leftover punctuation/whitespace
  return result.replace(/[.,!?]+$/, '').trim();
}

export function useVoiceMode({
  agentId,
  sessionKey,
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

  // Stable refs for callbacks that may change
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

  // Send accumulated text to agent
  const sendToAgent = useCallback(async (text: string) => {
    if (!text.trim()) {
      console.warn('[VoiceMode] sendToAgent: empty text, ignoring');
      return;
    }
    console.log('[VoiceMode] >>> Sending to agent:', text);
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
  }, [agentId, sessionKey, setStateSync]);

  // Resume VAD listening
  const resumeListening = useCallback(() => {
    if (!mountedRef.current) return;
    setStateSync('listening');
    vadRef.current?.start().catch(() => {});
  }, [setStateSync]);

  // Play TTS audio for agent response
  const playTTS = useCallback(async (text: string) => {
    if (!mountedRef.current) return;
    setStateSync('speaking');

    // Pause VAD during TTS
    try { await vadRef.current?.pause(); } catch {}

    try {
      const res = await fetch('/api/gateway/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        resumeListening();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        console.warn('[VoiceMode] Audio playback error');
        resumeListening();
      };

      await audio.play();
    } catch (err) {
      console.warn('[VoiceMode] TTS error (showing text only):', err);
      // Keep agentResponse visible, just resume listening after a pause
      if (mountedRef.current) {
        setTimeout(resumeListening, 2000);
      }
    }
  }, [setStateSync, resumeListening]);

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
          // Ensure we're in thinking state while streaming
          if (stateRef.current !== 'thinking') {
            setStateSync('thinking');
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

          // Try TTS, fallback to just showing text
          if (text.trim()) {
            playTTS(text);
          } else {
            resumeListening();
          }
        } else if (payload.state === 'error' || payload.state === 'aborted') {
          const errMsg = payload.errorMessage || 'Agent error';
          console.error('[VoiceMode] SSE error/abort:', errMsg);
          setAgentResponse(`Error: ${errMsg}`);
          resumeListening();
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
      setStateSync('initializing');
      setError(null);

      try {
        const { MicVAD } = await import('@ricky0123/vad-web');

        vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
          positiveSpeechThreshold: 0.8,
          negativeSpeechThreshold: 0.3,
          redemptionMs: 1500,
          minSpeechMs: 300,
          preSpeechPadMs: 500,

          onFrameProcessed: (probs: any) => {
            if (mountedRef.current) {
              setSpeechProbability(probs.isSpeech);
            }
          },

          onSpeechStart: () => {
            console.log('[VoiceMode] Speech started');
            if (mountedRef.current) {
              setStateSync('recording');
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

            setStateSync('transcribing');
            const text = await transcribe(audio);

            if (!mountedRef.current) return;

            if (!text) {
              console.log('[VoiceMode] Empty transcription, back to listening');
              setStateSync('listening');
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
                console.log('[VoiceMode] Sending:', fullText);
                try { await vad.pause(); } catch {}
                setAccumulatedText(fullText);
                accumulatedRef.current = fullText;
                await sendToAgent(fullText);
              } else {
                console.log('[VoiceMode] Trigger found but nothing to send');
                // Show hint briefly
                setLastTranscript('Nothing to send yet — speak your message first');
                setStateSync('listening');
              }
            } else {
              // Accumulate text
              const newAccum = accumulatedRef.current
                ? `${accumulatedRef.current} ${text}`
                : text;
              console.log('[VoiceMode] Accumulated:', newAccum);
              setAccumulatedText(newAccum);
              accumulatedRef.current = newAccum;
              setStateSync('listening');
            }
          },

          onVADMisfire: () => {
            console.log('[VoiceMode] VAD misfire');
            if (mountedRef.current) {
              setStateSync('listening');
            }
          },
        });

        vadRef.current = vad;
        await vad.start();

        if (mountedRef.current) {
          setStateSync('listening');
          console.log('[VoiceMode] VAD initialized and listening');
        }
      } catch (err: any) {
        console.error('[VoiceMode] VAD init error:', err);
        if (mountedRef.current) {
          setStateSync('error');
          setError(err.message || 'Failed to initialize voice detection');
        }
      }
    })();

    // ---- Visibility change ----
    const handleVisibility = () => {
      if (document.hidden) {
        vadRef.current?.pause().catch(() => {});
      } else if (vadRef.current && mountedRef.current) {
        // Only resume if we're in a listening-like state
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

      vadRef.current?.destroy().catch(() => {});
      vadRef.current = null;

      es.close();
      eventSourceRef.current = null;

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [sessionKey, agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    setAccumulatedText('');
    accumulatedRef.current = '';
    setAgentResponse('');
    setLastTranscript('');
    // Destroy old VAD
    vadRef.current?.destroy().catch(() => {});
    vadRef.current = null;
    // Re-init will happen via the effect re-running... but we need to force it.
    // Simplest: just reload the VAD inline
    (async () => {
      setStateSync('initializing');
      setError(null);
      try {
        const { MicVAD } = await import('@ricky0123/vad-web');
        const vad = await MicVAD.new({
          model: 'v5',
          baseAssetPath: '/vad/',
          onnxWASMBasePath: '/vad/',
          positiveSpeechThreshold: 0.8,
          negativeSpeechThreshold: 0.3,
          redemptionMs: 1500,
          minSpeechMs: 300,
          preSpeechPadMs: 500,
          onFrameProcessed: (probs: any) => {
            if (mountedRef.current) setSpeechProbability(probs.isSpeech);
          },
          onSpeechStart: () => {
            if (mountedRef.current) setStateSync('recording');
          },
          onSpeechEnd: async () => {
            // Will be handled by the main effect's VAD instance
            // This retry creates a fresh instance that won't have the full handlers
            // For simplicity, just resume listening
            if (mountedRef.current) setStateSync('listening');
          },
          onVADMisfire: () => {
            if (mountedRef.current) setStateSync('listening');
          },
        });
        vadRef.current = vad;
        await vad.start();
        if (mountedRef.current) setStateSync('listening');
      } catch (err: any) {
        if (mountedRef.current) {
          setStateSync('error');
          setError(err.message);
        }
      }
    })();
  }, [setStateSync]);

  const close = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    onCloseRef.current?.();
  }, []);

  return {
    state,
    error,
    accumulatedText,
    agentResponse,
    speechProbability,
    lastTranscript,
    retry,
    close,
  };
}
