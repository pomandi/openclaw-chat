import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { sendChatMessageSync } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// POST /api/gateway/chat — send a message and get response
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { agentId, message } = await req.json();

    if (!agentId || !message) {
      return NextResponse.json({ error: 'agentId and message required' }, { status: 400 });
    }

    const reply = await sendChatMessageSync(agentId, message);
    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('[API] chat send error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
