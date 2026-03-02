'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useVoiceMode, VoiceModeState, ResponseMode } from '@/lib/useVoiceMode';
import { Agent, getAgentName } from '@/lib/types';
import VoiceSettings from './VoiceSettings';
import TalkingHead from './TalkingHead';
import type { HeadState } from './TalkingHead';
import type { VoiceSettings as VoiceSettingsType } from '@/lib/voiceSettings';

interface VoiceModeProps {
  agent: Agent;
  sessionKey: string;
  responseMode: ResponseMode;
  onClose: () => void;
  onMessageSent?: (text: string) => void;
  onAgentResponse?: (text: string) => void;
}

const STATE_LABELS: Record<VoiceModeState, string> = {
  initializing: 'Starting...',
  listening: 'Listening...',
  recording: 'Recording...',
  transcribing: 'Transcribing...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
  error: 'Error',
};

function toHeadState(s: VoiceModeState): HeadState {
  switch (s) {
    case 'listening': return 'listening';
    case 'recording': return 'recording';
    case 'thinking':
    case 'transcribing': return 'thinking';
    case 'speaking': return 'speaking';
    default: return 'idle';
  }
}

export default function VoiceMode({
  agent,
  sessionKey,
  responseMode,
  onClose,
  onMessageSent,
  onAgentResponse,
}: VoiceModeProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [mouthOpenness, setMouthOpenness] = useState(0);
  const agentName = getAgentName(agent);
  const rafRef = useRef<number>(0);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const {
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
  } = useVoiceMode({
    agentId: agent.id,
    sessionKey,
    responseMode,
    onMessageSent,
    onAgentResponse,
    onClose: handleClose,
  });

  // rAF loop for lip-sync
  useEffect(() => {
    function tick() {
      const level = getAudioLevel();
      setMouthOpenness(level);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getAudioLevel]);

  // Pulse scale based on speech probability and state
  const pulseScale = state === 'recording'
    ? 1 + speechProbability * 0.4
    : state === 'speaking'
      ? 1.1
      : 1;

  const pulseOpacity = state === 'recording'
    ? 0.3 + speechProbability * 0.5
    : state === 'listening'
      ? 0.2
      : state === 'speaking'
        ? 0.4
        : state === 'thinking'
          ? 0.3
          : 0;

  // Ring color based on state
  const ringColor = state === 'recording'
    ? 'var(--error)'
    : state === 'thinking'
      ? 'var(--warning)'
      : state === 'speaking'
        ? 'var(--success)'
        : state === 'error'
          ? 'var(--error)'
          : 'var(--accent)';

  const handleSettingsSave = useCallback((_settings: VoiceSettingsType) => {
    reloadSettings();
  }, [reloadSettings]);

  const canSend = accumulatedText.trim().length > 0
    && state !== 'thinking' && state !== 'speaking' && state !== 'transcribing';

  return (
    <div className="fixed inset-0 z-50 bg-[var(--bg-primary)] flex flex-col animate-fade-in safe-top safe-bottom">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={close}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
          title="Close voice mode"
        >
          <svg className="w-5 h-5 text-[var(--text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center">
          <div className="text-sm text-[var(--text-secondary)]">{agentName}</div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {responseMode === 'voice' ? 'Voice \u2194 Voice' : 'Voice \u2192 Text'}
          </div>
        </div>

        <div className="flex items-center gap-2 min-w-[80px] justify-end">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors active:scale-95"
            title="Voice settings"
          >
            <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <span className="text-xs text-[var(--text-muted)]">
            {STATE_LABELS[state]}
          </span>
        </div>
      </div>

      {/* Main content — scrollable */}
      <div className="flex-1 flex flex-col items-center gap-6 px-6 overflow-y-auto">
        {/* Spacer to push content toward center */}
        <div className="flex-1 min-h-8" />

        {/* Avatar with pulse ring */}
        <div className="relative shrink-0">
          {/* Outer pulse ring */}
          <div
            className={`absolute inset-0 rounded-full transition-all duration-300 ${
              state === 'listening' ? 'voice-pulse' : ''
            } ${state === 'speaking' ? 'voice-ripple' : ''}`}
            style={{
              transform: `scale(${pulseScale * 1.6})`,
              opacity: pulseOpacity,
              backgroundColor: ringColor,
            }}
          />
          {/* Inner pulse ring */}
          <div
            className="absolute inset-0 rounded-full transition-all duration-200"
            style={{
              transform: `scale(${pulseScale * 1.3})`,
              opacity: pulseOpacity * 0.6,
              backgroundColor: ringColor,
            }}
          />
          {/* Talking Head avatar */}
          <div
            className="relative w-24 h-24 rounded-full flex items-center justify-center border-2 transition-colors duration-300 overflow-hidden"
            style={{ borderColor: ringColor }}
          >
            <TalkingHead
              state={toHeadState(state)}
              mouthOpenness={mouthOpenness}
              size={96}
              accentColor={ringColor}
            />
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          {state === 'initializing' && (
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Loading voice detection...</span>
            </div>
          )}

          {state === 'listening' && (
            <div className="flex items-center gap-2 text-[var(--accent)]">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
              </svg>
              <span className="text-sm">Listening...</span>
            </div>
          )}

          {state === 'recording' && (
            <div className="flex items-center gap-2 text-[var(--error)]">
              <div className="w-3 h-3 rounded-full bg-[var(--error)] animate-pulse" />
              <span className="text-sm">Recording...</span>
            </div>
          )}

          {state === 'transcribing' && (
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Transcribing...</span>
            </div>
          )}

          {state === 'thinking' && (
            <div className="flex items-center gap-2 text-[var(--warning)]">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-[var(--warning)] typing-dot" />
                <div className="w-2 h-2 rounded-full bg-[var(--warning)] typing-dot" />
                <div className="w-2 h-2 rounded-full bg-[var(--warning)] typing-dot" />
              </div>
              <span className="text-sm">Thinking...</span>
            </div>
          )}

          {state === 'speaking' && (
            <div className="flex items-center gap-2 text-[var(--success)]">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              <span className="text-sm">Speaking...</span>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-[var(--error)]">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">{error || 'Something went wrong'}</span>
              </div>
              <button
                onClick={retry}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-sm transition-colors active:scale-95"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Last transcript (debug/feedback) */}
        {lastTranscript && state !== 'thinking' && state !== 'speaking' && (
          <div className="text-xs text-[var(--text-muted)] text-center italic max-w-sm">
            &ldquo;{lastTranscript}&rdquo;
          </div>
        )}

        {/* Accumulated user text */}
        {accumulatedText && (
          <div className="w-full max-w-md shrink-0">
            {state !== 'thinking' && state !== 'speaking' && (
              <div className="text-xs text-[var(--text-muted)] mb-1 text-center">Your message:</div>
            )}
            <div className={`bg-[var(--bubble-user)] text-white px-4 py-3 rounded-2xl text-[15px] leading-relaxed max-h-32 overflow-y-auto text-center ${
              state === 'thinking' || state === 'speaking' ? 'opacity-50' : ''
            }`}>
              {accumulatedText}
            </div>
          </div>
        )}

        {/* Send button — visible when there's accumulated text */}
        {canSend && (
          <button
            onClick={manualSend}
            className="flex items-center gap-2 px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-2xl text-sm font-medium transition-all active:scale-95 shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Send
          </button>
        )}

        {/* Agent response */}
        {agentResponse && (
          <div className="w-full max-w-md shrink-0">
            <div className="bg-[var(--bubble-assistant)] text-[var(--text-primary)] px-4 py-3 rounded-2xl text-[15px] leading-relaxed max-h-48 overflow-y-auto">
              {agentResponse}
            </div>
          </div>
        )}

        {/* Spacer bottom */}
        <div className="flex-1 min-h-4" />
      </div>

      {/* Footer hint */}
      <div className="px-6 py-3 text-center shrink-0">
        <p className="text-xs text-[var(--text-muted)]">
          Tap Send or say &quot;g&ouml;nder&quot; &middot; Auto-sends after silence &middot; &quot;kapat&quot; = close
        </p>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <VoiceSettings
          onClose={() => setShowSettings(false)}
          onSave={handleSettingsSave}
        />
      )}
    </div>
  );
}
