export interface VoiceSettings {
  voice: string;
  rate: number;            // -50 to +50 (percent)
  pitch: number;           // -20 to +20 (Hz)
  ttsVolume: number;       // 0.0 to 1.0
  ambientEnabled: boolean;
  ambientVolume: number;   // 0.02 to 0.20
  ambientSource: string;   // 'default' | filename from public/music/
  autoSendDelay: number;   // 2 to 8 (seconds)
}

export const VOICE_DEFAULTS: VoiceSettings = {
  voice: 'tr-TR-EmelNeural',
  rate: -8,
  pitch: -2,
  ttsVolume: 1.0,
  ambientEnabled: true,
  ambientVolume: 0.08,
  ambientSource: 'default',
  autoSendDelay: 4,
};

export const AVAILABLE_VOICES = [
  { id: 'tr-TR-EmelNeural', label: 'Emel (TR)', lang: 'tr' },
  { id: 'tr-TR-AhmetNeural', label: 'Ahmet (TR)', lang: 'tr' },
  { id: 'en-US-JennyNeural', label: 'Jenny (EN)', lang: 'en' },
  { id: 'en-US-GuyNeural', label: 'Guy (EN)', lang: 'en' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia (UK)', lang: 'en' },
] as const;

const STORAGE_KEY = 'voice-settings';

export function loadVoiceSettings(): VoiceSettings {
  if (typeof window === 'undefined') return { ...VOICE_DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...VOICE_DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...VOICE_DEFAULTS, ...parsed };
  } catch {
    return { ...VOICE_DEFAULTS };
  }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}
