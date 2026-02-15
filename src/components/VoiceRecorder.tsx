'use client';

import { useEffect, useRef } from 'react';
import { useVoiceRecorder, RecorderState } from '@/lib/useVoiceRecorder';

interface VoiceRecorderProps {
  onSend: (dataUrl: string, duration: number, mimeType: string) => void;
  disabled?: boolean;
}

export default function VoiceRecorder({ onSend, disabled }: VoiceRecorderProps) {
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

  // Draw waveform
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
    const step = Math.floor(analyserData.length / barCount);

    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < barCount; i++) {
      const val = analyserData[i * step] / 255;
      const barHeight = Math.max(3, val * h * 0.9);
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

  function handleCancel() {
    if (state === 'recording') {
      cancelRecording();
    } else if (state === 'recorded') {
      clearRecording();
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Idle state — just the mic button
  if (state === 'idle' || state === 'error') {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={handleMicClick}
          disabled={disabled}
          className="p-2.5 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] rounded-full transition-colors shrink-0 disabled:opacity-30"
          title="Record voice message"
        >
          <MicIcon />
        </button>
        {error && state === 'error' && (
          <div className="absolute bottom-full mb-2 right-0 bg-[var(--error)]/90 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap max-w-[250px] truncate">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Recording state
  if (state === 'recording' || state === 'requesting') {
    return (
      <div className="flex items-center gap-2 flex-1 animate-fade-in">
        {/* Cancel button */}
        <button
          type="button"
          onClick={handleCancel}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-hover)] rounded-full transition-colors shrink-0"
          title="Cancel recording"
        >
          <TrashIcon />
        </button>

        {/* Recording indicator */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-2.5 h-2.5 bg-[var(--error)] rounded-full animate-pulse shrink-0" />
          <span className="text-xs text-[var(--error)] font-mono shrink-0">{formatTime(duration)}</span>
          
          {/* Waveform */}
          <canvas
            ref={canvasRef}
            width={160}
            height={28}
            className="flex-1 max-w-[160px] h-7"
          />
        </div>

        {/* Stop/Send button */}
        <button
          type="button"
          onClick={stopRecording}
          className="p-2.5 bg-[var(--error)] hover:bg-[var(--error)]/80 text-white rounded-full transition-colors shrink-0"
          title="Stop recording"
        >
          <StopIcon />
        </button>
      </div>
    );
  }

  // Recorded state — preview
  if (state === 'recorded' && recording) {
    return (
      <div className="flex items-center gap-2 flex-1 animate-fade-in">
        {/* Delete button */}
        <button
          type="button"
          onClick={handleCancel}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-hover)] rounded-full transition-colors shrink-0"
          title="Discard recording"
        >
          <TrashIcon />
        </button>

        {/* Mini audio preview */}
        <RecordingPreview url={recording.url} duration={recording.duration} />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          className="p-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-full transition-colors shrink-0"
          title="Send voice message"
        >
          <SendIcon />
        </button>
      </div>
    );
  }

  return null;
}

function RecordingPreview({ url, duration }: { url: string; duration: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = import('react').then ? undefined as any : undefined;

  // Use state locally
  const { useState: useStateLocal } = require('react');
  // Actually let me use a different approach to avoid require
  return <RecordingPreviewInner url={url} duration={duration} />;
}

function RecordingPreviewInner({ url, duration }: { url: string; duration: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = (await import('react')).useState ? undefined as any : undefined;

  // Fix: just use a simpler functional component with proper imports at top
  return <SimplePreview url={url} duration={duration} />;
}

// Simpler approach
import { useState as useStateHook } from 'react';

function SimplePreview({ url, duration }: { url: string; duration: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useStateHook(false);
  const [progress, setProgress] = useStateHook(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (audio.duration) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
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
      audio.play();
      setIsPlaying(true);
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 bg-[var(--bg-tertiary)] rounded-full">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className="text-[var(--accent)] shrink-0"
      >
        {isPlaying ? <PauseSmallIcon /> : <PlaySmallIcon />}
      </button>
      <div className="flex-1 h-1 bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--accent)] rounded-full transition-all duration-100"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
        {formatTime(duration)}
      </span>
    </div>
  );
}


// --- Icons ---

function MicIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
    </svg>
  );
}

function PlaySmallIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseSmallIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </svg>
  );
}
