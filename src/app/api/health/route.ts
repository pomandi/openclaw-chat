import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/health — diagnostic endpoint
export async function GET(req: NextRequest) {
  const authed = isAuthenticatedFromRequest(req);
  
  const diagnostics: Record<string, any> = {
    app: 'ok',
    auth: authed ? 'ok' : 'unauthorized',
    timestamp: new Date().toISOString(),
    build: process.env.BUILD_ID || 'unknown',
    nodeVersion: process.version,
  };
  
  // Only run gateway test if authenticated
  if (authed) {
    try {
      const gwUrl = process.env.OPENCLAW_GATEWAY_HTTP_URL || 'http://127.0.0.1:18789';
      const gwToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';
      const start = Date.now();
      
      const res = await fetch(`${gwUrl}/`, {
        headers: { 'Authorization': `Bearer ${gwToken}` },
        signal: AbortSignal.timeout(5000),
      });
      
      diagnostics.gateway = {
        status: res.ok ? 'ok' : `error:${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      diagnostics.gateway = { status: 'error', error: err.message };
    }
  }
  
  return NextResponse.json(diagnostics);
}
