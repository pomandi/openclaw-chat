'use client';

import { useState, useCallback, useRef } from 'react';
import {
  VoiceSettings as VoiceSettingsType,
  VOICE_DEFAULTS,
  AVAILABLE_VOICES,
  loadVoiceSettings,
  saveVoiceSettings,
} from '@/lib/voiceSettings';

interface VoiceSettingsProps {
  onClose: () => void;
  onSave: (settings: VoiceSettingsType) => void;
}

export default function VoiceSettings({ onClose, onSave }: VoiceSettingsProps) {
  const [settings, setSettings] = useState<VoiceSettingsType>(loadVoiceSettings);
  const [previewing, setPreviewing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const update = useCallback(<K extends keyof VoiceSettingsType>(key: K, value: VoiceSettingsType[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    saveVoiceSettings(settings);
    onSave(settings);
    onClose();
  }, [settings, onSave, onClose]);

  const handleReset = useCallback(() => {
    setSettings({ ...VOICE_DEFAULTS });
  }, []);

  const handlePreview = useCallback(async () => {
    if (previewing) return;
    setPreviewing(true);

    // Stop any previous preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    try {
      const res = await fetch('/api/gateway/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Merhaba, ben senin sesli asistanınım. Nasıl duyuluyorum?',
          voice: settings.voice,
          rate: settings.rate,
          pitch: settings.pitch,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error('TTS failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
        setPreviewing(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
        setPreviewing(false);
      };

      await audio.play();
    } catch {
      setPreviewing(false);
    }
  }, [settings.voice, settings.rate, settings.pitch, previewing]);

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--bg-primary)] flex flex-col animate-fade-in safe-top safe-bottom">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <button
          onClick={onClose}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
          title="Back"
        >
          <svg className="w-5 h-5 text-[var(--text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="text-sm font-medium text-[var(--text-primary)]">Voice Settings</span>

        <button
          onClick={handleSave}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-sm font-medium transition-colors active:scale-95"
        >
          Save
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

        {/* Voice Selection */}
        <Section title="Voice">
          <div className="flex gap-3">
            {AVAILABLE_VOICES.map(v => (
              <button
                key={v.id}
                onClick={() => update('voice', v.id)}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all active:scale-95 ${
                  settings.voice === v.id
                    ? 'bg-[var(--accent)] text-white shadow-md'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Speed */}
        <Section title="Speed" value={`${settings.rate > 0 ? '+' : ''}${settings.rate}%`}>
          <input
            type="range"
            min={-50}
            max={50}
            step={1}
            value={settings.rate}
            onChange={e => update('rate', Number(e.target.value))}
            className="w-full accent-[var(--accent)] h-2 rounded-full"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
            <span>-50%</span>
            <span>0</span>
            <span>+50%</span>
          </div>
        </Section>

        {/* Pitch */}
        <Section title="Pitch" value={`${settings.pitch > 0 ? '+' : ''}${settings.pitch}Hz`}>
          <input
            type="range"
            min={-20}
            max={20}
            step={1}
            value={settings.pitch}
            onChange={e => update('pitch', Number(e.target.value))}
            className="w-full accent-[var(--accent)] h-2 rounded-full"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
            <span>-20Hz</span>
            <span>0</span>
            <span>+20Hz</span>
          </div>
        </Section>

        {/* Preview */}
        <button
          onClick={handlePreview}
          disabled={previewing}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] rounded-xl text-sm font-medium transition-all active:scale-95 disabled:opacity-50"
        >
          {previewing ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-[var(--text-secondary)]">Playing...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-[var(--text-primary)]">Preview</span>
            </>
          )}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-xs text-[var(--text-muted)]">Background Music</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {/* Ambient Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)]">Enabled</span>
          <button
            onClick={() => update('ambientEnabled', !settings.ambientEnabled)}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.ambientEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'
            }`}
          >
            <div
              className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.ambientEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Ambient Volume */}
        {settings.ambientEnabled && (
          <Section title="Volume" value={settings.ambientVolume.toFixed(2)}>
            <input
              type="range"
              min={0.02}
              max={0.20}
              step={0.01}
              value={settings.ambientVolume}
              onChange={e => update('ambientVolume', Number(e.target.value))}
              className="w-full accent-[var(--accent)] h-2 rounded-full"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
              <span>0.02</span>
              <span>0.20</span>
            </div>
          </Section>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-xs text-[var(--text-muted)]">Timing</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {/* Auto-send delay */}
        <Section title="Auto-send delay" value={`${settings.autoSendDelay}s`}>
          <input
            type="range"
            min={2}
            max={8}
            step={0.5}
            value={settings.autoSendDelay}
            onChange={e => update('autoSendDelay', Number(e.target.value))}
            className="w-full accent-[var(--accent)] h-2 rounded-full"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
            <span>2s</span>
            <span>8s</span>
          </div>
        </Section>

        {/* Reset */}
        <button
          onClick={handleReset}
          className="w-full px-4 py-3 text-sm text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
        >
          Reset Defaults
        </button>

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  );
}

function Section({ title, value, children }: { title: string; value?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[var(--text-primary)]">{title}</span>
        {value && <span className="text-xs text-[var(--text-muted)] font-mono">{value}</span>}
      </div>
      {children}
    </div>
  );
}
