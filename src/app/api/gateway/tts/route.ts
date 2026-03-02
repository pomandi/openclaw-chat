import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Clean text for natural TTS output — remove markdown, code, URLs, etc.
function cleanTextForTTS(raw: string): string {
  let text = raw;
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`[^`]+`/g, '');
  // Remove markdown headers
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Remove markdown bold/italic
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
  // Remove markdown links — keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, '');
  // Remove bullet points
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');
  // Remove numbered lists prefix
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  // Remove emojis (common ranges)
  text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  // Collapse multiple newlines/spaces
  text = text.replace(/\n{2,}/g, '. ');
  text = text.replace(/\n/g, ' ');
  text = text.replace(/\s{2,}/g, ' ');
  return text.trim();
}

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

    const cleanedText = cleanTextForTTS(text);
    if (!cleanedText) {
      return NextResponse.json({ error: 'no speakable text' }, { status: 400 });
    }

    const { EdgeTTS } = await import('node-edge-tts');
    const tts = new EdgeTTS({
      voice: 'tr-TR-EmelNeural',
      rate: '-8%',       // Slightly slower — more natural, less rushed
      pitch: '-2Hz',     // Slightly lower pitch — warmer tone
      volume: '+0%',
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    });

    await tts.ttsPromise(cleanedText, tmpFile);

    const audioBuffer = await readFile(tmpFile);
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
    unlink(tmpFile).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
