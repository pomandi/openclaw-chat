import { NextRequest } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { onGatewayEvent, getConnection } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');

  // Ensure gateway connection is alive
  try {
    await getConnection();
  } catch {
    return new Response('Gateway unavailable', { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      // Send heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // Listen for chat events
      const unsubChat = onGatewayEvent('chat', (payload: any) => {
        if (!sessionKey || payload.sessionKey === sessionKey) {
          send({ type: 'chat', ...payload });
        }
      });

      // Listen for agent events
      const unsubAgent = onGatewayEvent('agent.event', (payload: any) => {
        if (!sessionKey || payload.sessionKey === sessionKey) {
          send({ type: 'agent.event', ...payload });
        }
      });

      // Listen for all events (wildcard) for debugging
      const unsubAll = onGatewayEvent('*', (data: any) => {
        // Only forward relevant events
        if (data.event === 'chat' || data.event === 'agent.event') return; // Already handled
        if (data.event === 'state.update' || data.event === 'tick') return; // Skip noisy events
        send({ type: data.event, ...data.payload });
      });

      // Cleanup on abort
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubChat();
        unsubAgent();
        unsubAll();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
