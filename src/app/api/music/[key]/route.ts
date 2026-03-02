import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, isR2Configured } from '@/lib/r2';

// GET /api/music/[key] — stream audio from R2
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 });
  }

  const { key } = await params;
  const fullKey = `music/${key}`;

  try {
    const cmd = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: fullKey,
    });
    const result = await r2.send(cmd);

    if (!result.Body) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bytes = await result.Body.transformToByteArray();
    const buffer = Buffer.from(bytes);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': result.ContentType || 'audio/mpeg',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    if (err.name === 'NoSuchKey') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[Music API] Stream error:', err);
    return NextResponse.json({ error: 'Failed to stream' }, { status: 500 });
  }
}

// DELETE /api/music/[key] — delete track from R2
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 });
  }

  const { key } = await params;
  const fullKey = `music/${key}`;

  try {
    const cmd = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: fullKey,
    });
    await r2.send(cmd);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Music API] Delete error:', err);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
