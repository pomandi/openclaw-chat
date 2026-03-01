import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';
import { readFile } from 'fs/promises';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/gateway/tts — convert text to speech via gateway Edge TTS
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }

    const gw = getGatewayWS();

    // Request TTS conversion from gateway
    const result = await gw.request('tts.convert', { text: text.trim() }, 25000);

    if (!result?.audioPath) {
      return NextResponse.json({ error: 'TTS conversion failed' }, { status: 502 });
    }

    // Read the audio file from the shared volume mount
    // Gateway writes to /tmp/openclaw/tts-*/ which is mounted in the container
    const audioBuffer = await readFile(result.audioPath);

    // Determine content type from extension
    const ext = result.audioPath.split('.').pop()?.toLowerCase();
    const contentType = ext === 'mp3' ? 'audio/mpeg'
      : ext === 'wav' ? 'audio/wav'
      : ext === 'ogg' ? 'audio/ogg'
      : 'audio/mpeg';

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('[TTS] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
