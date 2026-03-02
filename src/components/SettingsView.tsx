'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  VoiceSettings,
  VOICE_DEFAULTS,
  AVAILABLE_VOICES,
  loadVoiceSettings,
  saveVoiceSettings,
} from '@/lib/voiceSettings';

interface MusicTrack {
  filename: string;
  name: string;
  url: string;
}

const PREVIEW_TEXT: Record<string, string> = {
  tr: 'Merhaba, ben senin sesli asistanınim. Nasıl duyuluyorum?',
  en: 'Hello, I am your voice assistant. How do I sound?',
};

export default function SettingsView() {
  const [settings, setSettings] = useState<VoiceSettings>(loadVoiceSettings);
  const [previewing, setPreviewing] = useState(false);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [saved, setSaved] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambientCtxRef = useRef<AudioContext | null>(null);
  const ambientStopRef = useRef<(() => void) | null>(null);

  // Load music tracks on mount
  useEffect(() => {
    fetch('/api/music')
      .then(res => res.json())
      .then(data => setTracks(data.tracks || []))
      .catch(() => {});
  }, []);

  const update = useCallback(<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    saveVoiceSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings({ ...VOICE_DEFAULTS });
    setSaved(false);
  }, []);

  const getPreviewLang = useCallback((): string => {
    const voice = AVAILABLE_VOICES.find(v => v.id === settings.voice);
    return voice?.lang || 'tr';
  }, [settings.voice]);

  // Stop any running ambient preview
  const stopAmbientPreview = useCallback(() => {
    if (ambientStopRef.current) {
      ambientStopRef.current();
      ambientStopRef.current = null;
    }
  }, []);

  // Start ambient music for preview
  const startAmbientPreview = useCallback(() => {
    if (!settings.ambientEnabled) return;
    stopAmbientPreview();

    if (!ambientCtxRef.current) {
      ambientCtxRef.current = new AudioContext();
    }
    const ctx = ambientCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const vol = settings.ambientVolume;

    if (settings.ambientSource === 'default') {
      // Synth pad
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      const oscs: OscillatorNode[] = [];
      const freqs = [130.81, 164.81, 196.00, 246.94];
      for (const freq of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (Math.random() - 0.5) * 8;
        const g = ctx.createGain();
        g.gain.value = 0.12;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        filter.Q.value = 0.5;
        osc.connect(filter);
        filter.connect(g);
        g.connect(master);
        osc.start();
        oscs.push(osc);
      }

      // Fade in
      const now = ctx.currentTime;
      master.gain.setValueAtTime(0, now);
      master.gain.linearRampToValueAtTime(vol, now + 0.8);

      ambientStopRef.current = () => {
        const t = ctx.currentTime;
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + 0.8);
        setTimeout(() => oscs.forEach(o => { try { o.stop(); } catch {} }), 1000);
      };
    } else {
      // Custom music file
      const musicAudio = new Audio(`/music/${encodeURIComponent(settings.ambientSource)}`);
      musicAudio.loop = true;
      musicAudio.volume = vol * 5; // scale up since ambient volumes are 0.02-0.20
      musicAudio.play().catch(() => {});

      ambientStopRef.current = () => {
        musicAudio.pause();
        musicAudio.src = '';
      };
    }
  }, [settings.ambientEnabled, settings.ambientSource, settings.ambientVolume, stopAmbientPreview]);

  const handlePreview = useCallback(async () => {
    if (previewing) return;
    setPreviewing(true);

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    // Start ambient music alongside TTS
    startAmbientPreview();

    try {
      const lang = getPreviewLang();
      const res = await fetch('/api/gateway/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: PREVIEW_TEXT[lang] || PREVIEW_TEXT.tr,
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
      audio.volume = settings.ttsVolume;
      previewAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
        stopAmbientPreview();
        setPreviewing(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
        stopAmbientPreview();
        setPreviewing(false);
      };

      await audio.play();
    } catch {
      stopAmbientPreview();
      setPreviewing(false);
    }
  }, [settings, previewing, getPreviewLang, startAmbientPreview, stopAmbientPreview]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Settings</h1>
        <button
          onClick={handleSave}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95 ${
            saved
              ? 'bg-[var(--success)] text-white'
              : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
          }`}
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">

        {/* === VOICE SECTION === */}
        <SectionHeader>Voice</SectionHeader>

        {/* Voice grid */}
        <div className="grid grid-cols-2 gap-2">
          {AVAILABLE_VOICES.map(v => (
            <button
              key={v.id}
              onClick={() => update('voice', v.id)}
              className={`px-3 py-3 rounded-xl text-sm font-medium transition-all active:scale-95 ${
                settings.voice === v.id
                  ? 'bg-[var(--accent)] text-white shadow-md'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Speed */}
        <Slider label="Speed" value={`${settings.rate > 0 ? '+' : ''}${settings.rate}%`}
          min={-50} max={50} step={1} current={settings.rate}
          onChange={v => update('rate', v)} marks={['-50%', '0', '+50%']} />

        {/* Pitch */}
        <Slider label="Pitch" value={`${settings.pitch > 0 ? '+' : ''}${settings.pitch}Hz`}
          min={-20} max={20} step={1} current={settings.pitch}
          onChange={v => update('pitch', v)} marks={['-20Hz', '0', '+20Hz']} />

        {/* TTS Volume */}
        <Slider label="TTS Volume" value={`${Math.round(settings.ttsVolume * 100)}%`}
          min={0} max={1} step={0.05} current={settings.ttsVolume}
          onChange={v => update('ttsVolume', v)} marks={['0%', '50%', '100%']} />

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
              <span className="text-[var(--text-primary)]">Preview Voice</span>
            </>
          )}
        </button>

        {/* === BACKGROUND MUSIC SECTION === */}
        <SectionHeader>Background Music</SectionHeader>

        {/* Ambient Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-primary)]">Enabled</span>
          <button
            onClick={() => update('ambientEnabled', !settings.ambientEnabled)}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.ambientEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'
            }`}
          >
            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              settings.ambientEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {settings.ambientEnabled && (
          <>
            <Slider label="Volume" value={settings.ambientVolume.toFixed(2)}
              min={0.02} max={0.20} step={0.01} current={settings.ambientVolume}
              onChange={v => update('ambientVolume', v)} marks={['0.02', '0.20']} />

            {/* Source Selector */}
            <div>
              <div className="text-sm text-[var(--text-primary)] mb-2">Source</div>
              <div className="space-y-2">
                <button
                  onClick={() => update('ambientSource', 'default')}
                  className={`w-full px-3 py-2.5 rounded-xl text-sm text-left transition-all active:scale-[0.98] ${
                    settings.ambientSource === 'default'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  Default Synth Pad
                </button>
                {tracks.map(track => (
                  <button
                    key={track.filename}
                    onClick={() => update('ambientSource', track.filename)}
                    className={`w-full px-3 py-2.5 rounded-xl text-sm text-left transition-all active:scale-[0.98] truncate ${
                      settings.ambientSource === track.filename
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {track.name}
                  </button>
                ))}
                {tracks.length === 0 && (
                  <p className="text-xs text-[var(--text-muted)] italic">
                    Add .mp3 files to public/music/ to see them here
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* === TIMING SECTION === */}
        <SectionHeader>Timing</SectionHeader>

        <Slider label="Auto-send delay" value={`${settings.autoSendDelay}s`}
          min={2} max={8} step={0.5} current={settings.autoSendDelay}
          onChange={v => update('autoSendDelay', v)} marks={['2s', '8s']} />

        {/* === ABOUT SECTION === */}
        <SectionHeader>About</SectionHeader>

        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="flex justify-between">
            <span>Version</span>
            <span className="font-mono text-[var(--text-muted)]">0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span>App</span>
            <span className="font-mono text-[var(--text-muted)]">OpenClaw Chat</span>
          </div>
        </div>

        {/* Reset Defaults */}
        <button
          onClick={handleReset}
          className="w-full px-4 py-3 text-sm text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
        >
          Reset All Defaults
        </button>

        <div className="h-8" />
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[var(--border)]" />
      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{children}</span>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  );
}

function Slider({
  label, value, min, max, step, current, onChange, marks,
}: {
  label: string; value: string; min: number; max: number; step: number;
  current: number; onChange: (v: number) => void; marks: string[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[var(--text-primary)]">{label}</span>
        <span className="text-xs text-[var(--text-muted)] font-mono">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)] h-2 rounded-full"
      />
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
        {marks.map((m, i) => <span key={i}>{m}</span>)}
      </div>
    </div>
  );
}
