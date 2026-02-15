'use client';

import { useState, useEffect, useRef } from 'react';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';

interface VoiceRecorderProps {
  onSend: (dataUrl: string, duration: number, mimeType: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export default function VoiceRecorder({ onSend, onCancel, disabled }: VoiceRecorderProps) {
  const {
    state,
    duration,
    recording,
    error,
    analyserData,
    startRecording,
    stopRecording,
    cancelRecording,
    clearRecording,
  } = useVoiceRecorder();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoStarted = useRef(false);

  // Auto-start recording on mount
  useEffect(() => {
    if (!autoStarted.current && state === 'idle') {
      autoStarted.current = true;
      startRecording();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw waveform visualization during recording
  useEffect(() => {
    if (!canvasRef.current || !analyserData) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const barCount = 24;
    const barWidth = (w / barCount) * 0.6;
    const gap = (w / barCount) * 0.4;
    const step = Math.max(1, Math.floor(analyserData.length / barCount));

    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < barCount; i++) {
      const val = analyserData[i * step] / 255;
      const barHeight = Math.max(3, val * h * 0.85);
      const x = i * (barWidth + gap);
      const y = (h - barHeight) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1.5);
      ctx.fill();
    }
  }, [analyserData]);

  function handleMicClick() {
    if (state === 'idle' || state === 'error') {
      startRecording();
    } else if (state === 'recording') {
      stopRecording();
    }
  }

  function handleSend() {
    if (recording) {
      onSend(recording.dataUrl, recording.duration, recording.blob.type);
      clearRecording();
    }
  }

  function handleDiscard() {
    if (state === 'recording') {
      cancelRecording();
      onCancel?.();
    } else if (state === 'recorded') {
      clearRecording();
      onCancel?.();
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ---- Idle / Error: show retry or back ----
  if (state === 'idle' || state === 'error') {
    return (
      <div className="relative flex items-center gap-2 flex-1 min-h-[44px]">
        <button
          type="button"
          onClick={() => onCancel?.()}
          className="flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-xl transition-colors shrink-0 active:scale-95"
          title="Back to text"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {error && (
          <span className="text-xs text-[var(--error)] truncate flex-1">{error}</span>
        )}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={disabled}
          className="flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-xl transition-colors shrink-0 disabled:opacity-30 active:scale-95"
          title="Try again"
        >
          <MicIcon />
        </button>
      </div>
    );
  }

  // ---- Recording state ----
  if (state === 'recording' || state === 'requesting') {
    return (
      <div className="flex items-center gap-2 flex-1 animate-fade-in min-h-[44px]">
        {/* Cancel — large touch target */}
        <button
          type="button"
          onClick={handleDiscard}
          className="flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 rounded-xl transition-colors shrink-0 active:scale-95"
          title="Cancel recording"
        >
          <TrashIcon />
        </button>

        {/* Recording indicator + waveform */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-3 h-3 bg-[var(--error)] rounded-full animate-pulse shrink-0" />
          <span className="text-sm text-[var(--error)] font-mono shrink-0 min-w-[40px]">
            {formatTime(duration)}
          </span>
          <canvas
            ref={canvasRef}
            width={160}
            height={32}
            className="flex-1 max-w-[160px] h-8"
          />
        </div>

        {/* Stop — large prominent button */}
        <button
          type="button"
          onClick={stopRecording}
          className="flex items-center justify-center w-11 h-11 bg-[var(--error)] hover:bg-[var(--error)]/80 text-white rounded-xl transition-colors shrink-0 active:scale-95 shadow-md shadow-[var(--error)]/20"
          title="Stop recording"
        >
          <StopIcon />
        </button>
      </div>
    );
  }

  // ---- Recorded state: preview + send ----
  if (state === 'recorded' && recording) {
    return (
      <div className="flex items-center gap-2 flex-1 animate-fade-in min-h-[44px]">
        {/* Delete — large touch target */}
        <button
          type="button"
          onClick={handleDiscard}
          className="flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 rounded-xl transition-colors shrink-0 active:scale-95"
          title="Discard recording"
        >
          <TrashIcon />
        </button>

        {/* Mini preview player */}
        <MiniPlayer url={recording.url} duration={recording.duration} />

        {/* Send — large prominent button */}
        <button
          type="button"
          onClick={handleSend}
          className="flex items-center justify-center w-11 h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl transition-colors shrink-0 active:scale-95 shadow-md shadow-[var(--accent)]/20"
          title="Send voice message"
        >
          <SendIcon />
        </button>
      </div>
    );
  }

  return null;
}

// ---- Mini player for recording preview ----
function MiniPlayer({ url, duration }: { url: string; duration: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 bg-[var(--bg-tertiary)] rounded-xl h-11">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button type="button" onClick={togglePlay} className="text-[var(--accent)] shrink-0 w-6 h-6 flex items-center justify-center">
        {isPlaying ? <PauseSmallIcon /> : <PlaySmallIcon />}
      </button>
      <div className="flex-1 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--accent)] rounded-full transition-all duration-100"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="text-[11px] text-[var(--text-muted)] font-mono shrink-0">
        {formatTime(duration)}
      </span>
    </div>
  );
}

// ---- Audio player for chat bubbles (exported for use in ChatView) ----
export function AudioBubblePlayer({
  src,
  duration,
  isUser,
}: {
  src: string;
  duration?: number;
  isUser: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setProgress(audio.currentTime / audio.duration);
        if (!duration) setAudioDuration(audio.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };
    const onLoaded = () => {
      if (audio.duration && isFinite(audio.duration) && !duration) {
        setAudioDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoaded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [duration]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
    setProgress(pct);
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const accentColor = isUser ? 'rgba(255,255,255,0.8)' : 'var(--accent)';
  const trackColor = isUser ? 'rgba(255,255,255,0.2)' : 'var(--border)';
  const textColor = isUser ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)';

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] max-w-[260px]">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors active:scale-95"
        style={{
          backgroundColor: isUser ? 'rgba(255,255,255,0.15)' : 'var(--accent)/15',
          color: accentColor,
        }}
      >
        {isPlaying ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Progress + duration */}
      <div className="flex-1 min-w-0">
        <div
          className="relative h-7 flex items-center cursor-pointer"
          onClick={handleProgressClick}
        >
          <WaveformBars progress={progress} accentColor={accentColor} trackColor={trackColor} />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[10px] font-mono" style={{ color: textColor }}>
            {isPlaying && audioRef.current
              ? formatTime(audioRef.current.currentTime)
              : '0:00'}
          </span>
          <span className="text-[10px] font-mono" style={{ color: textColor }}>
            {formatTime(audioDuration)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Decorative waveform bars for audio bubble
function WaveformBars({
  progress,
  accentColor,
  trackColor,
}: {
  progress: number;
  accentColor: string;
  trackColor: string;
}) {
  const bars = [0.3, 0.5, 0.7, 0.4, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.9, 0.4, 0.6, 0.8, 0.3, 0.7, 0.5, 0.4, 0.8, 0.6, 0.3, 0.9, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5];
  const total = bars.length;

  return (
    <div className="flex items-center gap-[2px] w-full h-full">
      {bars.map((h, i) => {
        const filled = i / total < progress;
        return (
          <div
            key={i}
            className="flex-1 rounded-full transition-colors duration-75"
            style={{
              height: `${h * 100}%`,
              backgroundColor: filled ? accentColor : trackColor,
              minWidth: '2px',
            }}
          />
        );
      })}
    </div>
  );
}


// ---- SVG Icons ----

function MicIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function PlaySmallIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseSmallIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </svg>
  );
}
