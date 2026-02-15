import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getChatHistory, sendChatMessage, abortChat } from '@/lib/gateway';

// GET /api/gateway/chat?sessionKey=xxx — get chat history
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100');

  try {
    const result = await getChatHistory(sessionKey, limit);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API] chat history error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

// POST /api/gateway/chat — send a message
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { sessionKey, message, action } = await req.json();

    if (action === 'abort') {
      if (!sessionKey) {
        return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
      }
      const result = await abortChat(sessionKey);
      return NextResponse.json(result);
    }

    if (!sessionKey || !message) {
      return NextResponse.json({ error: 'sessionKey and message required' }, { status: 400 });
    }

    const result = await sendChatMessage(sessionKey, message);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API] chat send error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
