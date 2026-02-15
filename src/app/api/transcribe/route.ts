import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WHISPER_URL = process.env.WHISPER_URL || '';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const GATEWAY_HTTP_URL = process.env.OPENCLAW_GATEWAY_HTTP_URL || 'http://127.0.0.1:18789';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// POST /api/transcribe — transcribe audio to text
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { audio, language } = await req.json();

    if (!audio) {
      return NextResponse.json({ error: 'audio (base64 data URL) required' }, { status: 400 });
    }

    // Extract base64 data and mime type from data URL
    const dataUrlMatch = audio.match(/^data:([^;]+);base64,(.+)$/);
    if (!dataUrlMatch) {
      return NextResponse.json({ error: 'Invalid audio data URL format' }, { status: 400 });
    }

    const mimeType = dataUrlMatch[1];
    const base64Data = dataUrlMatch[2];
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Determine file extension
    const ext = mimeType.includes('webm') ? 'webm'
      : mimeType.includes('ogg') ? 'ogg'
      : mimeType.includes('mp4') ? 'mp4'
      : mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3'
      : mimeType.includes('wav') ? 'wav'
      : 'webm';

    // Strategy 1: Try custom Whisper service if configured
    if (WHISPER_URL) {
      try {
        console.log(`[Transcribe] Trying custom Whisper at ${WHISPER_URL}`);
        const res = await fetch(`${WHISPER_URL}/transcribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
          },
          body: JSON.stringify({ audio, language: language || 'tr' }),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.text?.trim()) {
            console.log(`[Transcribe] Custom Whisper success: ${data.text.substring(0, 50)}...`);
            return NextResponse.json(data);
          }
        } else {
          console.warn(`[Transcribe] Custom Whisper error: ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[Transcribe] Custom Whisper failed: ${err.message}`);
      }
    }

    // Strategy 2: Try OpenClaw Gateway's audio transcription endpoint
    try {
      console.log('[Transcribe] Trying Gateway /v1/audio/transcriptions');
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer], { type: mimeType });
      formData.append('file', audioBlob, `audio.${ext}`);
      formData.append('model', 'whisper-1');
      if (language) formData.append('language', language);

      const res = await fetch(`${GATEWAY_HTTP_URL}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        },
        body: formData,
        signal: AbortSignal.timeout(45000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text?.trim()) {
          console.log(`[Transcribe] Gateway success: ${data.text.substring(0, 50)}...`);
          return NextResponse.json({ text: data.text });
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[Transcribe] Gateway error: ${res.status} ${errText.substring(0, 200)}`);
      }
    } catch (err: any) {
      console.warn(`[Transcribe] Gateway failed: ${err.message}`);
    }

    // Strategy 3: Try OpenAI Whisper API directly
    if (OPENAI_API_KEY) {
      try {
        console.log('[Transcribe] Trying OpenAI Whisper API');
        const formData = new FormData();
        const audioBlob = new Blob([audioBuffer], { type: mimeType });
        formData.append('file', audioBlob, `audio.${ext}`);
        formData.append('model', 'whisper-1');
        if (language) formData.append('language', language);

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: formData,
          signal: AbortSignal.timeout(45000),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.text?.trim()) {
            console.log(`[Transcribe] OpenAI success: ${data.text.substring(0, 50)}...`);
            return NextResponse.json({ text: data.text });
          }
        } else {
          console.warn(`[Transcribe] OpenAI error: ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[Transcribe] OpenAI failed: ${err.message}`);
      }
    }

    // All strategies failed
    console.error('[Transcribe] All transcription methods failed');
    return NextResponse.json({ text: '', error: 'Transcription unavailable' }, { status: 200 });
  } catch (err: any) {
    console.error('[Transcribe] Unexpected error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
