import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WHISPER_URL = process.env.WHISPER_URL || 'http://10.0.1.1:18791';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// POST /api/transcribe — transcribe audio to text
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { audio, language } = await req.json();

    if (!audio) {
      return NextResponse.json({ error: 'audio (base64) required' }, { status: 400 });
    }

    const res = await fetch(`${WHISPER_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({ audio, language: language || 'tr' }),
      signal: AbortSignal.timeout(55000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[API] transcribe error:', err);
      return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[API] transcribe error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
