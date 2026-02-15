import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { sendChatMessage } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// POST /api/gateway/chat/stream — send message with streaming response
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { agentId, message } = await req.json();

    if (!agentId || !message) {
      return NextResponse.json({ error: 'agentId and message required' }, { status: 400 });
    }

    const stream = await sendChatMessage(agentId, message);
    if (!stream) {
      return NextResponse.json({ error: 'No response stream' }, { status: 502 });
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('[API] chat stream error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
