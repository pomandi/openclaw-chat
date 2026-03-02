import { NextRequest, NextResponse } from 'next/server';
import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, isR2Configured } from '@/lib/r2';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4'];

// GET /api/music — list uploaded tracks
export async function GET() {
  if (!isR2Configured()) {
    return NextResponse.json({ tracks: [], configured: false });
  }

  try {
    const cmd = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: 'music/',
    });
    const result = await r2.send(cmd);

    const tracks = (result.Contents || [])
      .filter(obj => obj.Key && obj.Key !== 'music/')
      .map(obj => ({
        key: obj.Key!,
        name: obj.Key!.replace(/^music\/\d+-/, ''),
        size: obj.Size || 0,
        lastModified: obj.LastModified?.toISOString(),
      }));

    return NextResponse.json({ tracks, configured: true });
  } catch (err: any) {
    console.error('[Music API] List error:', err);
    return NextResponse.json({ error: 'Failed to list tracks' }, { status: 500 });
  }
}

// POST /api/music — upload audio file
export async function POST(req: NextRequest) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: MP3, WAV, OGG, WebM, AAC' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
    }

    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `music/${Date.now()}-${sanitizedName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    });
    await r2.send(cmd);

    return NextResponse.json({
      key,
      name: sanitizedName,
      size: file.size,
    });
  } catch (err: any) {
    console.error('[Music API] Upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
