import { NextRequest } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for long-lived SSE connections

// GET /api/gateway/events?sessionKey=agent:main:main — SSE stream for real-time chat events
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const sessionKeyFilter = url.searchParams.get('sessionKey');
  
  const gw = getGatewayWS();
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial connection confirmation
      controller.enqueue(encoder.encode(': connected\n\n'));
      
      function onChat(payload: any) {
        try {
          // Filter by sessionKey if specified
          if (sessionKeyFilter && payload.sessionKey !== sessionKeyFilter) {
            return;
          }
          
          const data = JSON.stringify(payload);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch (err) {
          console.error('[SSE] Failed to send chat event:', err);
        }
      }
      
      // Keepalive every 15s to prevent connection timeout
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // Client disconnected, cleanup will happen in abort handler
        }
      }, 15000);
      
      // Listen for chat events from gateway
      gw.on('chat', onChat);
      
      // Cleanup when browser disconnects
      req.signal.addEventListener('abort', () => {
        console.log('[SSE] Client disconnected, cleaning up...');
        gw.off('chat', onChat);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
      
      // Also cleanup on error
      const cleanup = () => {
        gw.off('chat', onChat);
        clearInterval(keepalive);
      };
      
      // Store cleanup for potential use
      (controller as any)._cleanup = cleanup;
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}