import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { listSessions } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const agentId = req.nextUrl.searchParams.get('agentId') || undefined;
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');

  try {
    const result = await listSessions({ agentId, limit });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API] sessions error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
