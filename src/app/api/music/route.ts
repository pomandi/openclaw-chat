import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';

const MUSIC_DIR = join(process.cwd(), 'public', 'music');
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.webm', '.aac', '.m4a'];

// GET /api/music — list music files from public/music/
export async function GET() {
  try {
    const files = await readdir(MUSIC_DIR);
    const tracks = files
      .filter(f => AUDIO_EXTS.some(ext => f.toLowerCase().endsWith(ext)))
      .map(f => ({
        filename: f,
        name: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        url: `/music/${f}`,
      }));

    return NextResponse.json({ tracks });
  } catch {
    // Directory doesn't exist or is empty
    return NextResponse.json({ tracks: [] });
  }
}
