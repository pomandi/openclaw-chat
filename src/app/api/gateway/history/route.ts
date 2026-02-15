import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The transcript server runs on the host and serves parsed transcript data
// Docker containers access it via the host gateway IP (10.0.1.1)
const TRANSCRIPT_SERVER_URL = process.env.TRANSCRIPT_SERVER_URL || 'http://10.0.1.1:18790';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// GET /api/gateway/history?sessionKey=agent:main:main&limit=50
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  const limitStr = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitStr || '50', 10) || 50, 1), 200);

  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
  }

  // Validate session key format: agent:{agentId}:main
  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent') {
    return NextResponse.json({ error: 'Invalid sessionKey format' }, { status: 400 });
  }

  try {
    const url = `${TRANSCRIPT_SERVER_URL}/history?sessionKey=${encodeURIComponent(sessionKey)}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[API] transcript server error:', res.status, text);
      return NextResponse.json({ messages: [], sessionKey });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[API] history error:', err.message);
    return NextResponse.json({ messages: [], sessionKey });
  }
}
