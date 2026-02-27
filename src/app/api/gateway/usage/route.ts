import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';

export const dynamic = 'force-dynamic';

// GET /api/gateway/usage?sessionKey=agent:main:main
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
  }

  try {
    const gw = getGatewayWS();
    const usage = await gw.sessionUsage(sessionKey);

    // Extract the key stats from the response
    const session = usage?.sessions?.[0];
    const totals = usage?.totals;

    return NextResponse.json({
      totals: totals ? {
        input: totals.input ?? 0,
        output: totals.output ?? 0,
        cacheRead: totals.cacheRead ?? 0,
        cacheWrite: totals.cacheWrite ?? 0,
        totalTokens: totals.totalTokens ?? 0,
        totalCost: totals.totalCost ?? 0,
      } : null,
      messages: usage?.messages ?? null,
      session: session ? {
        key: session.key,
        label: session.label,
        input: session.input ?? 0,
        output: session.output ?? 0,
        cacheRead: session.cacheRead ?? 0,
        totalTokens: session.totalTokens ?? 0,
        totalCost: session.totalCost ?? 0,
        messageCounts: session.messageCounts ?? null,
      } : null,
    });
  } catch (err: any) {
    console.error('[API] usage error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
