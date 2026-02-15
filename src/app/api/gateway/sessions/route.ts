import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/gateway/sessions — placeholder for session listing
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Sessions are managed by the gateway internally
  // For now return empty list - chat creates sessions on demand
  return NextResponse.json({ sessions: [] });
}
