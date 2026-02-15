import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import WebSocket from 'ws';

export const dynamic = 'force-dynamic';

const GATEWAY_HTTP_URL = process.env.OPENCLAW_GATEWAY_HTTP_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Convert HTTP URL to WS URL
function getWsUrl(): string {
  return GATEWAY_HTTP_URL.replace(/^http/, 'ws');
}

interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part.type === 'text' && part.text)
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

async function fetchChatHistory(sessionKey: string, limit: number): Promise<HistoryMessage[]> {
  return new Promise((resolve, reject) => {
    const wsUrl = getWsUrl();
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout'));
    }, 15000);

    let connected = false;
    const reqId = `hist_${Date.now()}`;

    ws.on('open', () => {
      // Send connect handshake
      const connectFrame = {
        type: 'req',
        id: 'connect_1',
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'webchat',
            displayName: 'OpenClaw Chat App',
            version: '1.0.0',
            platform: 'web',
            mode: 'webchat',
          },
          auth: {
            token: GATEWAY_TOKEN,
          },
          scopes: ['chat'],
        },
      };
      ws.send(JSON.stringify(connectFrame));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle hello-ok response (connect succeeded)
        if (msg.type === 'hello-ok' || (msg.type === 'res' && msg.id === 'connect_1' && msg.ok)) {
          connected = true;
          // Send chat.history request
          const historyReq = {
            type: 'req',
            id: reqId,
            method: 'chat.history',
            params: {
              sessionKey,
              limit,
            },
          };
          ws.send(JSON.stringify(historyReq));
          return;
        }

        // Handle chat.history response
        if (msg.type === 'res' && msg.id === reqId) {
          clearTimeout(timeout);
          ws.close();

          if (!msg.ok) {
            resolve([]);
            return;
          }

          const rawMessages = msg.payload?.messages || [];
          const messages: HistoryMessage[] = [];
          let idx = 0;

          for (const m of rawMessages) {
            const role = m.role;
            if (role !== 'user' && role !== 'assistant') continue;

            const text = extractTextContent(m.content);
            if (!text.trim()) continue;

            // Skip internal messages
            if (text.startsWith('[cron:') || text.startsWith('[heartbeat')) continue;

            const ts = typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() :
                       typeof m.timestamp === 'number' ? m.timestamp : Date.now();

            messages.push({
              id: `hist_${idx++}_${ts}`,
              role,
              content: text,
              timestamp: ts,
            });
          }

          resolve(messages);
          return;
        }

        // Skip events/ticks
      } catch (err) {
        // ignore parse errors
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!connected) {
        reject(new Error('WebSocket closed before connect'));
      }
    });
  });
}

// GET /api/gateway/history?sessionKey=agent:main:main&limit=50
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  const limitStr = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitStr || '50', 10) || 50, 1), 200);

  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
  }

  // Validate session key format: agent:{agentId}:main
  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent') {
    return NextResponse.json({ error: 'Invalid sessionKey format' }, { status: 400 });
  }

  try {
    const messages = await fetchChatHistory(sessionKey, limit);
    return NextResponse.json({
      messages,
      sessionKey,
      total: messages.length,
    });
  } catch (err: any) {
    console.error('[API] history error:', err.message);
    // Return empty on error rather than failing
    return NextResponse.json({
      messages: [],
      sessionKey,
      error: err.message,
    });
  }
}
