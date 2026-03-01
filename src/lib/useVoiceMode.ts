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

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float32 to int16
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  // Convert to base64 data URL
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

// Trigger words for sending the message
const TRIGGER_WORDS = ['gönder', 'gonder', 'yolla', 'send'];
const EXIT_WORDS = ['kapat', 'close'];

function hasTriggerWord(text: string): boolean {
  const lower = text.toLowerCase();
  return TRIGGER_WORDS.some(w => lower.includes(w));
}

function hasExitWord(text: string): boolean {
  const lower = text.toLowerCase();
  return EXIT_WORDS.some(w => lower.includes(w));
}

function stripTriggerWords(text: string): string {
  let result = text;
  for (const word of TRIGGER_WORDS) {
    result = result.replace(new RegExp(word, 'gi'), '');
  }
  return result.trim();
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

  const vadRef = useRef<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const accumulatedRef = useRef('');
  const mountedRef = useRef(true);
  const initCalledRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    accumulatedRef.current = accumulatedText;
  }, [accumulatedText]);

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
    if (!text.trim()) return;
    setState('thinking');
    setAgentResponse('');
    onMessageSent?.(text);

    try {
      const res = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message: text, sessionKey }),
      });
      if (!res.ok) {
        throw new Error(`Chat error: ${res.status}`);
      }
      // Response will come via SSE
    } catch (err: any) {
      console.error('[VoiceMode] Send error:', err);
      if (mountedRef.current) {
        setState('error');
        setError(`Send failed: ${err.message}`);
      }
    }
  }, [agentId, sessionKey, onMessageSent]);

  // Play TTS audio for agent response
  const playTTS = useCallback(async (text: string) => {
    if (!mountedRef.current) return;
    setState('speaking');

    // Pause VAD during TTS
    try { await vadRef.current?.pause(); } catch {}

    try {
      const res = await fetch('/api/gateway/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) throw new Error('TTS failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        if (mountedRef.current) {
          setState('listening');
          // Resume VAD
          vadRef.current?.start().catch(() => {});
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        if (mountedRef.current) {
          setState('listening');
          vadRef.current?.start().catch(() => {});
        }
      };

      await audio.play();
    } catch (err) {
      console.warn('[VoiceMode] TTS playback error:', err);
      // Fallback: just show text, resume listening
      if (mountedRef.current) {
        setState('listening');
        vadRef.current?.start().catch(() => {});
      }
    }
  }, []);

  // Setup SSE for agent responses
  const setupSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(
      `/api/gateway/events?sessionKey=${encodeURIComponent(sessionKey)}`
    );
    eventSourceRef.current = es;

    let fullResponse = '';

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const payload = JSON.parse(e.data);
        if (payload.sessionKey !== sessionKey) return;

        if (payload.state === 'delta') {
          const text =
            payload.message?.content?.[0]?.text ||
            payload.message?.content?.text ||
            payload.message?.content ||
            '';
          fullResponse = text;
          setAgentResponse(text);
        } else if (payload.state === 'final') {
          const content = payload.message?.content;
          const text = Array.isArray(content)
            ? content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : typeof content === 'string' ? content : String(content || '');

          fullResponse = text;
          setAgentResponse(text);
          onAgentResponse?.(text);

          // Reset accumulated text for next round
          setAccumulatedText('');
          accumulatedRef.current = '';

          // Play TTS of the final response
          if (text.trim()) {
            playTTS(text);
          } else {
            setState('listening');
            vadRef.current?.start().catch(() => {});
          }
          fullResponse = '';
        } else if (payload.state === 'error') {
          setAgentResponse(`Error: ${payload.errorMessage || 'Unknown error'}`);
          setState('listening');
          vadRef.current?.start().catch(() => {});
          fullResponse = '';
        }
      } catch (err) {
        console.error('[VoiceMode] SSE parse error:', err);
      }
    };

    es.onerror = () => {
      console.warn('[VoiceMode] SSE connection error, will reconnect...');
    };
  }, [sessionKey, onAgentResponse, playTTS]);

  // Initialize VAD
  const initVAD = useCallback(async () => {
    setState('initializing');
    setError(null);

    try {
      // Dynamic import to avoid SSR issues
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

        onFrameProcessed: (probs) => {
          if (mountedRef.current) {
            setSpeechProbability(probs.isSpeech);
          }
        },

        onSpeechStart: () => {
          console.log('[VoiceMode] Speech started');
          if (mountedRef.current) {
            setState('recording');
          }
        },

        onSpeechEnd: async (audio: Float32Array) => {
          console.log('[VoiceMode] Speech ended, samples:', audio.length);
          if (!mountedRef.current) return;

          setState('transcribing');
          const text = await transcribe(audio);

          if (!mountedRef.current) return;

          if (!text) {
            // Empty transcription, resume listening
            setState('listening');
            return;
          }

          console.log('[VoiceMode] Transcribed:', text);

          // Check for exit word
          if (hasExitWord(text)) {
            onClose?.();
            return;
          }

          // Check for trigger word
          if (hasTriggerWord(text)) {
            const cleanedSegment = stripTriggerWords(text);
            const fullText = accumulatedRef.current
              ? `${accumulatedRef.current} ${cleanedSegment}`.trim()
              : cleanedSegment;

            if (fullText) {
              // Pause VAD while sending
              try { await vad.pause(); } catch {}
              setAccumulatedText(fullText);
              accumulatedRef.current = fullText;
              await sendToAgent(fullText);
            } else {
              // Nothing to send
              setState('listening');
            }
          } else {
            // Accumulate text
            const newAccum = accumulatedRef.current
              ? `${accumulatedRef.current} ${text}`
              : text;
            setAccumulatedText(newAccum);
            accumulatedRef.current = newAccum;
            setState('listening');
          }
        },

        onVADMisfire: () => {
          console.log('[VoiceMode] VAD misfire (too short)');
          if (mountedRef.current) {
            setState('listening');
          }
        },
      });

      vadRef.current = vad;
      await vad.start();

      if (mountedRef.current) {
        setState('listening');
        console.log('[VoiceMode] VAD initialized and listening');
      }
    } catch (err: any) {
      console.error('[VoiceMode] VAD init error:', err);
      if (mountedRef.current) {
        setState('error');
        setError(err.message || 'Failed to initialize voice detection');
      }
    }
  }, [transcribe, sendToAgent, onClose]);

  // Request WakeLock
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[VoiceMode] WakeLock acquired');
      }
    } catch {
      // WakeLock not available or denied
    }
  }, []);

  // Initialize everything on mount
  useEffect(() => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    mountedRef.current = true;

    requestWakeLock();
    setupSSE();
    initVAD();

    // Handle tab visibility
    const handleVisibility = () => {
      if (document.hidden) {
        vadRef.current?.pause().catch(() => {});
      } else {
        if (vadRef.current && mountedRef.current) {
          vadRef.current.start().catch(() => {});
          // Re-acquire wake lock
          requestWakeLock();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);

      // Cleanup VAD
      vadRef.current?.destroy().catch(() => {});
      vadRef.current = null;

      // Cleanup SSE
      eventSourceRef.current?.close();
      eventSourceRef.current = null;

      // Cleanup audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // Release WakeLock
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    initCalledRef.current = false;
    setAccumulatedText('');
    accumulatedRef.current = '';
    setAgentResponse('');
    // Cleanup old instances first
    vadRef.current?.destroy().catch(() => {});
    vadRef.current = null;
    initCalledRef.current = true;
    initVAD();
  }, [initVAD]);

  const close = useCallback(() => {
    // Stop TTS if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    onClose?.();
  }, [onClose]);

  return {
    state,
    error,
    accumulatedText,
    agentResponse,
    speechProbability,
    retry,
    close,
  };
}
