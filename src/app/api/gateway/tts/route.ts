import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/gateway/tts — convert text to speech using Edge TTS directly
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tmpFile = join(tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

  try {
    const { text } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }

    // Use edge-tts directly — no gateway dependency, no volume mount needed
    const { EdgeTTS } = await import('node-edge-tts');
    const tts = new EdgeTTS({
      voice: 'tr-TR-EmelNeural',
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    });

    await tts.ttsPromise(text.trim(), tmpFile);

    const audioBuffer = await readFile(tmpFile);

    // Clean up temp file (fire-and-forget)
    unlink(tmpFile).catch(() => {});

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('[TTS] Error:', err.message);
    // Clean up on error
    unlink(tmpFile).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
