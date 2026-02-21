import { NextRequest } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';
import { getRPGClass, formatArenaEvent } from '@/lib/rpg-mapping';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET /api/gateway/arena/events — SSE stream for all agent events
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const gw = getGatewayWS();
  let eventCounter = 0;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(encoder.encode(': arena-connected\n\n'));

      function onGatewayEvent(msg: any) {
        try {
          const event = msg.event;
          const payload = msg.payload || {};

          // Extract agent ID from sessionKey or other fields
          let agentId = '';
          if (payload.sessionKey) {
            // Format: agent:agentId:xxx
            const parts = payload.sessionKey.split(':');
            if (parts.length >= 2) agentId = parts[1];
          }
          if (!agentId) agentId = payload.agentId || 'unknown';

          const rpg = getRPGClass(agentId);
          const now = Date.now();
          eventCounter++;

          let arenaEvent: any = null;

          if (event === 'chat') {
            const state = payload.state;
            if (state === 'delta') {
              // Don't send every delta, too noisy
              return;
            }
            if (state === 'final') {
              arenaEvent = {
                id: `evt-${eventCounter}`,
                timestamp: now,
                agentId,
                type: 'chat',
                message: formatArenaEvent(agentId, 'chat', 'responded'),
                icon: rpg.icon,
                color: rpg.color,
              };
            } else if (state === 'error') {
              arenaEvent = {
                id: `evt-${eventCounter}`,
                timestamp: now,
                agentId,
                type: 'status_change',
                message: formatArenaEvent(agentId, 'status_change', 'error'),
                icon: rpg.icon,
                color: rpg.color,
              };
            }
          } else if (event === 'agent.lifecycle') {
            const lifecycle = payload.state || payload.status;
            arenaEvent = {
              id: `evt-${eventCounter}`,
              timestamp: now,
              agentId,
              type: 'status_change',
              message: formatArenaEvent(agentId, 'status_change', lifecycle),
              icon: rpg.icon,
              color: rpg.color,
            };
          } else if (event === 'tool.call' || event === 'tool_call') {
            const toolName = payload.tool || payload.name || 'unknown';
            arenaEvent = {
              id: `evt-${eventCounter}`,
              timestamp: now,
              agentId,
              type: 'tool_call',
              message: formatArenaEvent(agentId, 'tool_call', toolName),
              icon: rpg.icon,
              color: rpg.color,
            };
          } else if (event === 'cron.start' || event === 'cron.run') {
            arenaEvent = {
              id: `evt-${eventCounter}`,
              timestamp: now,
              agentId,
              type: 'quest_start',
              message: formatArenaEvent(agentId, 'quest_start', payload.jobName || payload.name || 'cron'),
              icon: rpg.icon,
              color: rpg.color,
            };
          } else if (event === 'cron.complete' || event === 'cron.done') {
            arenaEvent = {
              id: `evt-${eventCounter}`,
              timestamp: now,
              agentId,
              type: 'quest_complete',
              message: formatArenaEvent(agentId, 'quest_complete', payload.jobName || payload.name || 'cron'),
              icon: rpg.icon,
              color: rpg.color,
            };
          } else if (event === 'cron.error' || event === 'cron.fail') {
            arenaEvent = {
              id: `evt-${eventCounter}`,
              timestamp: now,
              agentId,
              type: 'quest_fail',
              message: formatArenaEvent(agentId, 'quest_fail', payload.jobName || payload.name || 'cron'),
              icon: rpg.icon,
              color: rpg.color,
            };
          }

          if (arenaEvent) {
            const data = JSON.stringify(arenaEvent);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (err) {
          console.error('[Arena SSE] Failed to process event:', err);
        }
      }

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // Client disconnected
        }
      }, 15000);

      gw.on('gateway-event', onGatewayEvent);
      gw.on('chat', (payload: any) => {
        // Also capture chat events as gateway events for status tracking
        onGatewayEvent({ event: 'chat', payload });
      });

      req.signal.addEventListener('abort', () => {
        gw.off('gateway-event', onGatewayEvent);
        clearInterval(keepalive);
        try { controller.close(); } catch {}
      });
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
