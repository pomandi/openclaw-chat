import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { listAgents } from '@/lib/gateway';

export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await listAgents();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API] agents error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
